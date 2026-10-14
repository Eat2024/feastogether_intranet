'use client';

import TooltipIconButton from '@/components/TooltipIconButton';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DragHandleRoundedIcon from '@mui/icons-material/DragHandleRounded';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import { useId } from 'react';
import { SHEET_LABEL_MAX, SHEET_VALUE_MAX } from './rules';

/** 表頭欄位（id 只供拖曳排序辨識，不會儲存） */
export type SheetFieldItem = { id: string; label: string; value: string };

const nameOf = (items: SheetFieldItem[], id: string | number) =>
  items.find((f) => f.id === id)?.label || '未命名欄位';
const positionOf = (items: SheetFieldItem[], id: string | number) => items.findIndex((f) => f.id === id) + 1;

function SortableField({
  item,
  disabled,
  onChange,
  onRemove,
}: {
  item: SheetFieldItem;
  disabled: boolean;
  onChange: (patch: Partial<SheetFieldItem>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  });

  return (
    <Box
      ref={setNodeRef}
      sx={{
        display: 'flex',
        gap: 1,
        alignItems: 'center',
        borderRadius: 1,
        bgcolor: 'background.paper',
        position: 'relative',
        zIndex: isDragging ? 1 : undefined,
        boxShadow: isDragging ? 4 : undefined,
      }}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {/* 只有把手可拖曳，輸入框仍可正常選取文字；把手可用鍵盤操作（空白鍵拿起、方向鍵移動） */}
      <Tooltip title="拖曳排序">
        <IconButton
          ref={setActivatorNodeRef}
          size="small"
          disabled={disabled}
          aria-label={`拖曳排序「${item.label || '未命名欄位'}」`}
          sx={{ cursor: disabled ? undefined : isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
          {...attributes}
          {...listeners}
        >
          <DragHandleRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <TextField
        size="small"
        label="欄位名稱"
        value={item.label}
        disabled={disabled}
        onChange={(e) => onChange({ label: e.target.value })}
        slotProps={{ htmlInput: { maxLength: SHEET_LABEL_MAX } }}
        sx={{ width: 160, flexShrink: 0 }}
      />
      <TextField
        size="small"
        label="內容"
        fullWidth
        value={item.value}
        disabled={disabled}
        onChange={(e) => onChange({ value: e.target.value })}
        slotProps={{ htmlInput: { maxLength: SHEET_VALUE_MAX } }}
      />
      <TooltipIconButton
        label={`刪除「${item.label || '未命名欄位'}」`}
        icon={<DeleteOutlineRoundedIcon fontSize="small" />}
        color="error"
        disabled={disabled}
        onClick={onRemove}
      />
    </Box>
  );
}

/** 簽到表的表頭欄位清單：拖曳把手可調整順序 */
export default function SheetFieldList({
  items,
  disabled,
  onChange,
}: {
  items: SheetFieldItem[];
  disabled: boolean;
  onChange: (items: SheetFieldItem[]) => void;
}) {
  // 固定 id：dnd-kit 預設的流水號在伺服器與瀏覽器端可能不同，造成 hydration 警告
  const dndId = useId();
  const sensors = useSensors(
    // 移動 4px 以上才開始拖曳，避免點擊把手就觸發
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // 螢幕報讀器的提示改為中文
  const announcements: Announcements = {
    onDragStart: ({ active }) => `已拿起「${nameOf(items, active.id)}」，目前在第 ${positionOf(items, active.id)} 個。`,
    onDragOver: ({ active, over }) =>
      over ? `「${nameOf(items, active.id)}」移到第 ${positionOf(items, over.id)} 個。` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `已將「${nameOf(items, active.id)}」放在第 ${positionOf(items, over.id)} 個。` : `已放下「${nameOf(items, active.id)}」。`,
    onDragCancel: ({ active }) => `已取消移動「${nameOf(items, active.id)}」。`,
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((f) => f.id === active.id);
    const to = items.findIndex((f) => f.id === over.id);
    onChange(arrayMove(items, from, to));
  };

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: '按空白鍵或 Enter 拿起欄位，用上下方向鍵移動，再按空白鍵或 Enter 放下；按 Esc 取消。',
        },
      }}
    >
      <SortableContext items={items.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        <Stack spacing={1}>
          {items.map((item) => (
            <SortableField
              key={item.id}
              item={item}
              disabled={disabled}
              onChange={(patch) => onChange(items.map((f) => (f.id === item.id ? { ...f, ...patch } : f)))}
              onRemove={() => onChange(items.filter((f) => f.id !== item.id))}
            />
          ))}
        </Stack>
      </SortableContext>
    </DndContext>
  );
}
