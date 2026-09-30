"""Wireup AI configuration and bounded, stateless proposal endpoints."""
import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app.services.wireup_ai import (
    AIError, MAX_BYTES, ProposalRequest, ProposalResponse, ProviderConfig, generate_proposal,
)

router = APIRouter()


@router.get("/status")
@router.get("/config")
async def status():
    return ProviderConfig().status()


@router.post("/proposals", response_model=ProposalResponse)
async def propose(request: Request):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_BYTES:
            raise HTTPException(413, "AI request exceeds 512 KiB; reduce project context.")
    try:
        parsed = ProposalRequest.model_validate_json(body)
    except (ValidationError, ValueError, json.JSONDecodeError):
        raise HTTPException(422, "Invalid AI request. Check prompt, project schema, unique IDs, safe file paths, and context limits.") from None
    try:
        return await generate_proposal(parsed)
    except AIError as exc:
        raise HTTPException(exc.status, exc.message) from None
