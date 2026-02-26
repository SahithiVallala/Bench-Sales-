"""
Resume Parser Service
Extracts raw text from uploaded PDF or Word files
"""
import io
import pdfplumber
from pypdf import PdfReader
from docx import Document


def extract_text_from_file(file_bytes: bytes, filename: str) -> str:
    """Route to the correct parser based on file extension."""
    ext = filename.lower().rsplit(".", 1)[-1]
    if ext in ("doc", "docx"):
        return extract_text_from_docx(file_bytes)
    return extract_text_from_pdf(file_bytes)


def extract_text_from_docx(file_bytes: bytes) -> str:
    """Extract text from a Word .docx file."""
    try:
        doc = Document(io.BytesIO(file_bytes))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n".join(paragraphs).strip()
    except Exception as e:
        print(f"[Parser] docx error: {e}")
        return ""


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """
    Extract all text from a PDF file.
    Tries pdfplumber first (better for formatted resumes),
    falls back to pypdf if pdfplumber returns empty text.
    """
    text = _extract_with_pdfplumber(file_bytes)

    if not text or len(text.strip()) < 100:
        print("[Parser] pdfplumber returned little text, trying pypdf...")
        text = _extract_with_pypdf(file_bytes)

    return text.strip()


def _extract_with_pdfplumber(file_bytes: bytes) -> str:
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            pages_text = []
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    pages_text.append(page_text)
            return "\n".join(pages_text)
    except Exception as e:
        print(f"[Parser] pdfplumber error: {e}")
        return ""


def _extract_with_pypdf(file_bytes: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        pages_text = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                pages_text.append(text)
        return "\n".join(pages_text)
    except Exception as e:
        print(f"[Parser] pypdf error: {e}")
        return ""
