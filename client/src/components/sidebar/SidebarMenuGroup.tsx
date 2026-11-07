"use client";

import { useState } from "react";
import Link from "next/link";
import Collapse from "@mui/material/Collapse";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { alpha } from "@mui/material/styles";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import CircleIcon from "@mui/icons-material/Circle";
import { isRouteActive, type NavGroup } from "./services";

type Props = {
  item: NavGroup;
  pathname: string;
};

/** 可收合的選單群組；目前頁面在群組內時預設展開，左側顯示主色標記 */
export default function SidebarMenuGroup({ item, pathname }: Props) {
  const children = item.children;
  const isGroupActive = children.some((child) => isRouteActive(pathname, child.href));
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
              aria-current={isRouteActive(pathname, child.href) ? "page" : undefined}
              sx={{
                pl: 4,
                color: "inherit",
                "&.Mui-selected": { bgcolor: "primary.main" },
                "&.Mui-selected:hover": { bgcolor: "primary.dark" },
              }}
            >
              <ListItemIcon sx={{ color: "inherit", minWidth: 24 }}>
                <CircleIcon sx={{ fontSize: 6 }} />
              </ListItemIcon>
              <ListItemText primary={child.label} sx={{ whiteSpace: "nowrap" }} />
            </ListItemButton>
          ))}
        </List>
      </Collapse>
    </>
  );
}
