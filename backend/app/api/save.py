import json

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.models import GameSave, User
from app.schemas.save import SaveIn, SaveOut

router = APIRouter(prefix="/save", tags=["save"])

MAX_SAVE_BYTES = 64 * 1024  # 一份進度通常 < 2 KB；擋掉異常大的內容


@router.get("", response_model=SaveOut, summary="讀取目前帳號的遊戲進度（沒有存檔回 404）")
async def get_save(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    save = await db.get(GameSave, user.id)
    if save is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "尚無存檔")
    return save


@router.put("", response_model=SaveOut, summary="覆寫目前帳號的遊戲進度")
async def put_save(body: SaveIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if len(json.dumps(body.data, ensure_ascii=False).encode()) > MAX_SAVE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "存檔內容過大")
    save = await db.get(GameSave, user.id)
    if save is None:
        save = GameSave(user_id=user.id, data=body.data, version=1)
        db.add(save)
    else:
        save.data = body.data
        save.version += 1
    await db.commit()
    await db.refresh(save)
    return save


@router.delete("", status_code=status.HTTP_204_NO_CONTENT, summary="刪除目前帳號的遊戲進度")
async def delete_save(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    save = await db.get(GameSave, user.id)
    if save is not None:
        await db.delete(save)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
