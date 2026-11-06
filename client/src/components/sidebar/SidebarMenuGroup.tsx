"use client";

import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import CircleIcon from "@mui/icons-material/Circle";
import Collapse from "@mui/material/Collapse";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { alpha } from "@mui/material/styles";
import Link from "next/link";
import { useState } from "react";
import { isRouteActive, type NavItem } from "./services";

type Props = {
  item: NavItem;
  pathname: string;
};

/** 可收合的選單群組；目前頁面在群組內時預設展開，左側顯示主色標記 */
export default function SidebarMenuGroup({ item, pathname }: Props) {
  const children = item.children ?? [];
  const isGroupActive = children.some((child) =>
    isRouteActive(pathname, child.href),
  );
  const [open, setOpen] = useState(isGroupActive);
  const listId = `sidebar-group-${item.key}`;

  return (
    <>
      <ListItemButton
        onClick={() => setOpen((prev) => !prev)}
        selected={open}
        aria-expanded={open}
        aria-controls={listId}
        sx={(theme) => ({
          position: "relative",
          borderBottom: "1px solid",
          borderBottomColor: alpha(theme.palette.common.white, 0.12),
          "&.Mui-selected, &.Mui-selected:hover": {
            bgcolor: alpha(theme.palette.primary.main, 0.25),
          },
          "&::after": {
            content: '""',
            position: "absolute",
            top: "50%",
            left: 0,
            transform: "translateY(-50%)",
            width: 4,
            height: 40,
            bgcolor: "primary.main",
            borderRadius: 1,
            opacity: isGroupActive ? 1 : 0,
          },
        })}
      >
        <ListItemText primary={item.label} sx={{ whiteSpace: "nowrap" }} />
        <ListItemIcon sx={{ color: "inherit", minWidth: 0 }}>
          {open ? <ArrowDropUpIcon /> : <ArrowDropDownIcon />}
        </ListItemIcon>
      </ListItemButton>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <List
          id={listId}
          disablePadding
          sx={(theme) => ({
            borderBottom: "1px solid",
            borderBottomColor: alpha(theme.palette.common.white, 0.12),
          })}
        >
          {children.map((child) => (
            <ListItemButton
              key={child.key}
              component={Link}
              href={child.href}
              selected={isRouteActive(pathname, child.href)}
              sx={{
                // CKS 的 theme spacing 是 4px（pl: 4 = 16px），本專案是 8px
                pl: 2,
                // 長名稱換行時，圓點對齊第一行
                alignItems: "flex-start",
                color: "inherit",
                "&.Mui-selected": { bgcolor: "primary.main" },
                "&.Mui-selected:hover": { bgcolor: "primary.dark" },
              }}
            >
              <ListItemIcon
                sx={(theme) => ({
                  color: "inherit",
                  // 預設 56px 是給一般圖示的寬度，圓點只需留一點間距，讓文字有更多空間
                  minWidth: theme.spacing(2.5),
                  // 與 ListItemText 同樣的上外距，高度等於一行文字，圓點才會落在第一行中線
                  mt: 0.5,
                  height: `calc(${theme.typography.body2.fontSize} * ${theme.typography.body2.lineHeight})`,
                  alignItems: "center",
                })}
              >
                <CircleIcon sx={{ fontSize: 6 }} />
              </ListItemIcon>
              <ListItemText
                // secondary 以 body2（14px）顯示，比群組標題小一級；顏色沿用白字
                secondary={child.label}
                slotProps={{ secondary: { color: "inherit" } }}
              />
            </ListItemButton>
          ))}
        </List>
      </Collapse>
    </>
  );
}
