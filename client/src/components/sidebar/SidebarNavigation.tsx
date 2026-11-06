"use client";

import Link from "next/link";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import { alpha } from "@mui/material/styles";
import SidebarMenuGroup from "./SidebarMenuGroup";
import { isNavItemActive, type NavItem } from "./services";

type Props = {
  items: NavItem[];
  pathname: string;
};

/** 展開時的選單：沒有子選單的項目直接連結，有子選單的項目為可收合群組 */
export default function SidebarNavigation({ items, pathname }: Props) {
  return (
    <List component="nav" aria-label="功能選單" sx={{ color: "common.white" }}>
      {items.map((item) =>
        item.children?.length ? (
          <SidebarMenuGroup key={item.key} item={item} pathname={pathname} />
        ) : (
          <ListItemButton
            key={item.key}
            component={Link}
            href={item.href}
            selected={isNavItemActive(pathname, item)}
            sx={(theme) => ({
              borderBottom: "1px solid",
              borderBottomColor: alpha(theme.palette.common.white, 0.12),
              "&.Mui-selected": { bgcolor: "primary.main" },
              "&.Mui-selected:hover": { bgcolor: "primary.dark" },
            })}
          >
            <ListItemText primary={item.label} sx={{ whiteSpace: "nowrap" }} />
          </ListItemButton>
        ),
      )}
    </List>
  );
}
