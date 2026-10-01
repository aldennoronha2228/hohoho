"""Bounded plain-chat API. Status describes settings, not provider connectivity."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError

from app.services.ai_chat import (
    MAX_BODY_BYTES, MAX_TURN_BODY_BYTES, TurnRequest, TurnResponse,
    ChatError,
    ChatProvider,
    ChatRequest,
    ChatResponse,
    ChatSettings,
    OpenAICompatibleChatProvider,
)

from app.services.build_questions import BuildQuestionsRequest, BuildQuestionsResponse, generate_build_questions

router = APIRouter(prefix="/api/ai/chat", tags=["AI chat"])


def get_chat_provider() -> ChatProvider:
    try:
        return OpenAICompatibleChatProvider(ChatSettings.from_env())
    except ChatError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


@router.get("/status")
async def chat_status() -> dict:
    try:
        settings = ChatSettings.from_env()
    except ChatError as exc:
        return {"configured": False, "model": "", "message": exc.detail}
    return {"configured": settings.configured, "model": settings.model, "message": "Provider settings are configured; connectivity has not been checked." if settings.configured else "Set AI_API_KEY on the server to enable chat."}


async def read_body(request: Request, limit: int) -> bytes:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise HTTPException(status_code=415, detail="Expected an application/json body.")
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            length = int(content_length)
            if length < 0:
                raise ValueError
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid request body length.") from None
        if length > limit:
            raise HTTPException(status_code=413, detail="Chat request body is too large.")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > limit:
            raise HTTPException(status_code=413, detail="Chat request body is too large.")
        body.extend(chunk)
    return bytes(body)


async def read_chat_request(request: Request) -> ChatRequest:
    body = await read_body(request, MAX_BODY_BYTES)
    try:
        return ChatRequest.model_validate_json(body)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Invalid chat messages or conversation limits.") from None


async def read_turn_request(request: Request) -> TurnRequest:
    body = await read_body(request, MAX_TURN_BODY_BYTES)
    try:
        return TurnRequest.model_validate_json(body)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Invalid tool conversation, call IDs, or limits.") from None


async def read_questions_request(request: Request) -> BuildQuestionsRequest:
    body = await read_body(request, MAX_BODY_BYTES)
    try:
        return BuildQuestionsRequest.model_validate_json(body)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Enter a project request of 1–7000 characters.") from None


@router.post("/questions", response_model=BuildQuestionsResponse)
async def build_questions(payload: BuildQuestionsRequest = Depends(read_questions_request), provider: ChatProvider = Depends(get_chat_provider)) -> BuildQuestionsResponse:
    try:
        return await generate_build_questions(payload, provider)
    except ChatError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


@router.post("/turn", response_model=TurnResponse)
async def tool_turn(conversation: TurnRequest = Depends(read_turn_request), provider: ChatProvider = Depends(get_chat_provider)) -> TurnResponse:
    try:
        return await provider.turn(conversation.messages)
    except ChatError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


@router.post("", response_model=ChatResponse)
async def chat(
    conversation: ChatRequest = Depends(read_chat_request),
    provider: ChatProvider = Depends(get_chat_provider),
) -> ChatResponse:
    try:
        return await provider.chat(conversation.messages)
    except ChatError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
