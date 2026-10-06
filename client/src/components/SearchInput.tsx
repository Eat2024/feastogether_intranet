"use client";

// 共用搜尋輸入框：左側搜尋圖示；有輸入內容時右側顯示「✕」可一鍵清除（清除後游標留在輸入框）。
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField, { type TextFieldProps } from "@mui/material/TextField";
import { useRef } from "react";

type SearchInputProps = Omit<TextFieldProps, "value" | "onChange" | "slotProps"> & {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

export default function SearchInput({ value, onChange, placeholder, ...rest }: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <TextField
      size="small"
      {...rest}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      inputRef={inputRef}
      slotProps={{
        htmlInput: { "aria-label": placeholder },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchRoundedIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton
                size="small"
                edge="end"
                aria-label="清除搜尋"
                onClick={() => {
                  onChange("");
                  inputRef.current?.focus();
                }}
              >
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
}
