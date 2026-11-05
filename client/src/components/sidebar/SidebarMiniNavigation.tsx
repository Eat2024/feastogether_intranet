"use client";

import Link from "next/link";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { getNavItemHref, isRouteActive, type NavItem } from "./services";

type Props = {
  items: NavItem[];
  pathname: string;
};

/** 收合時的選單：只列第一層，圖示加短標籤；群組點了前往第一個子頁 */
export default function SidebarMiniNavigation({ items, pathname }: Props) {
  return (
    <List component="nav" aria-label="功能選單" sx={{ color: "common.white" }}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <ListItemButton
            key={item.key}
            component={Link}
            href={getNavItemHref(item)}
            selected={isRouteActive(pathname, item.href)}
            sx={{
              flexDirection: "column",
              alignItems: "center",
              px: 0.5,
              "&.Mui-selected": { bgcolor: "primary.main" },
              "&.Mui-selected:hover": { bgcolor: "primary.dark" },
            }}
          >
            <ListItemIcon sx={{ color: "inherit", minWidth: 0 }}>
              <Icon />
            </ListItemIcon>
            <ListItemText
              primary={item.label}
              slotProps={{ primary: { variant: "caption" } }}
              sx={{ textAlign: "center" }}
            />
          </ListItemButton>
        );
      })}
    </List>
  );
}
