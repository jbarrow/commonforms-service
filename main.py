from fastapi import FastAPI, UploadFile, HTTPException, File, status
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from datetime import datetime, timedelta
from contextlib import suppress
from pydantic import BaseModel
from typing import Literal
from pathlib import Path
from uuid import uuid4

import modal
import time
import os
import re

#import subprocess


MAX_BYTES = 100 * 1024 * 1024  # 100MB
CHUNK_SIZE = 1 * 1024 * 1024  # 1MB


def pdf_header_exists(chunk: bytes) -> bool:
    i = chunk.lstrip().find(b"%PDF-")
    return i == 0


async def stream_save_pdf(
    file: UploadFile, destination: Path
) -> tuple[int, int | None]:
    temp_path = destination.with_suffix(destination.suffix + ".part")
    total = 0
    header_buffer = bytearray()

    try:
        out = open(temp_path, "wb", buffering=CHUNK_SIZE)
        while chunk := await file.read(CHUNK_SIZE):
            if len(header_buffer) < 5:
                need = max(0, 1024 - len(header_buffer))
                header_buffer.extend(chunk[:need])

                if len(header_buffer) >= 5 and not pdf_header_exists(header_buffer):
                    raise HTTPException(400)

            total += len(chunk)

            if total > MAX_BYTES:
                raise HTTPException(400, "PDF exceeds 100 MB limit")

            out.write(chunk)

        if total == 0:
            raise HTTPException(400, "Empty upload")
        out.close()

        os.replace(temp_path, destination)

    except Exception as e:
        with suppress(FileNotFoundError):
            os.remove(temp_path)
        raise e

    return total, None



class PreparationConfig(BaseModel):
    model: Literal["small", "large"]
    sensitivity: int
    use_signature_fields: bool
    keep_existing_fields: bool


class PrepareRequest(BaseModel):
    documentId: str
    config: PreparationConfig


class StatusResponse(BaseModel):
    status: Literal["enqueued", "running", "success", "failure"]
    run_time: float
    queue_time: float


class DocumentResponse(BaseModel):
    documentId: str
    pages: int
    size: int


DATA_PATH = Path("/data")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libgl1-mesa-glx", "ffmpeg")
    .uv_pip_install(
        "formalpdf==0.1.5",
        "fastapi[standard]",
        "python-multipart",
        "pydantic",
        "commonforms==0.1.4"#,
        #gpu="T4"
    )
    .add_local_dir("./dist", "/root/dist")
)
app = modal.App(name="form-preparation", image=image)
volume = modal.Volume.from_name("form-preparation", create_if_missing=True)
requests = modal.Dict.from_name("form-preparation", create_if_missing=True)


with image.imports():
    import formalpdf
    from commonforms import prepare_form


MODEL_MAP = {
    "large": "FFDNet-L",
    "small": "FFDNet-S",
}


@app.function(volumes={str(DATA_PATH): volume},cpu=4.0)# gpu="T4")
def prepare_pdf(input_path: str | Path, output_path: str | Path, config: PreparationConfig, document_id: str):
    volume.reload()

    requests[document_id] |= {
        "status": "running",
        "run_time": datetime.now()
    }

    #subprocess.run(["nvidia-smi"])
    print(config.sensitivity)
    
    sensitivity_confidence = [0.8, 0.5, 0.3, 0.1, 0.01]
    conf = sensitivity_confidence[config.sensitivity-1]
    print(conf)
    
    try:
        prepare_form(
            input_path,
            output_path,
            keep_existing_fields=config.keep_existing_fields,
            use_signature_fields=config.use_signature_fields,
            model_or_path=MODEL_MAP[config.model],
            device = "cpu",#"cuda"
            confidence = conf
        )
        volume.commit()
        job_status = "success"
    except Exception as e:
        job_status = "failure"
        raise e
    finally:
        requests[document_id] |= {
            "complete_time": datetime.now(),
            "status": job_status
        }



@app.function(volumes={str(DATA_PATH): volume})
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def form_preparation():
    web_app = FastAPI()

    origins = [
        "http://localhost:5173",
        "http://localhost:5174",  # In case Vite uses alternate port
        "http://127.0.0.1:5173",
        "https://semanticdocs.org",
        "http://semanticdocs.org",
        "https://detect.semanticdocs.org",
        "http://detect.semanticdocs.org",
    ]

    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @web_app.post("/upload")
    async def upload(file: UploadFile = File(...)) -> DocumentResponse:
        document_id = str(uuid4())
        input_dir = DATA_PATH / "inputs"
        input_dir.mkdir(exist_ok=True, parents=True)
        input_path = input_dir / f"{document_id}.pdf"
        size, _ = await stream_save_pdf(file, input_path)

        document = formalpdf.open(input_path)
        pages = len(document)
        document.document.close()

        # Store the original filename for later use
        original_filename = file.filename or "document.pdf"
        requests[document_id] = {
            "original_filename": original_filename,
        }

        volume.commit()

        return DocumentResponse(documentId=document_id, pages=pages, size=size)

    @web_app.post("/detect")
    async def detect(request: PrepareRequest) -> StatusResponse:

        input_path = DATA_PATH / "inputs" / f"{request.documentId}.pdf"

        output_dir = DATA_PATH / "outputs"
        output_dir.mkdir(exist_ok=True)
        output_path = output_dir / f"{request.documentId}.pdf"

        # Get the original filename and create fillable version
        job_info = requests.get(request.documentId, {})
        original_filename = job_info.get("original_filename", "document.pdf")

        # Replace .pdf with _fillable.pdf
        if original_filename.lower().endswith(".pdf"):
            fillable_filename = original_filename[:-4] + "_fillable.pdf"
        else:
            fillable_filename = original_filename + "_fillable.pdf"

        requests[request.documentId] |= {
            "config": request.config,
            "status": "enqueued",
            "enqueue_time": datetime.now(),
            "run_time": None,
            "complete_time": None,
            "filename": fillable_filename,
        }

        volume.reload()  # Ensure we have the latest PDF from upload

        prepare_pdf.spawn(input_path, output_path, request.config, request.documentId)

        return StatusResponse(status="enqueued", queue_time=0.0, run_time=0.0)


    @web_app.get("/poll")
    async def poll(documentId: str) -> StatusResponse:
        job_status = requests.get(documentId, {})

        if not job_status or "status" not in job_status:
            # Document exists but detection hasn't started yet
            return StatusResponse(status="enqueued", queue_time=0.0, run_time=0.0)

        if job_status.get("status") in ["running", "success", "failure"]:
            run_time = ((job_status.get("complete_time") or datetime.now()) - job_status.get("run_time")).total_seconds()
        else:
            run_time = 0.

        queue_time = ((job_status.get("run_time") or datetime.now()) - (job_status.get("enqueue_time") or datetime.now())).total_seconds()

        return StatusResponse(
            status=job_status.get("status"),
            queue_time=queue_time,
            run_time=run_time,
        )


    @web_app.get("/download")
    async def download(documentId: str) -> FileResponse:
        job = requests.get(documentId)
        if job is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No document found for {documentId}",
            )

        output_dir = DATA_PATH / "outputs"
        output_path = output_dir / f"{documentId}.pdf"

        if not output_path.exists():
            try:
                volume.reload()
            except RuntimeError:
                time.sleep(2)
                volume.reload()

        return FileResponse(
            str(output_path),
            media_type="application/pdf",
            filename=job["filename"],
        )

    # Mount built frontend at root
    web_app.mount(
        "/",
        StaticFiles(directory=Path(__file__).parent / "dist", html=True),
        name="static",
    )

    return web_app


@app.function(schedule=modal.Period(hours=1), volumes={str(DATA_PATH): volume})
def clear_pdfs():
    """
    On a regularly scheduled time, go through and delete all old PDFs.
    """
    cutoff_ts = (datetime.now() - timedelta(hours=1)).timestamp()

    for folder in ("inputs", "outputs"):
        dir_path = DATA_PATH / folder
        if not dir_path.exists():
            continue

        for pdf_path in dir_path.glob("*.pdf"):
            with suppress(FileNotFoundError):
                # Delete if last modification is older than cutoff
                if pdf_path.stat().st_mtime < cutoff_ts:
                    pdf_path.unlink()

    volume.commit()
