"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import ListAltRoundedIcon from "@mui/icons-material/ListAltRounded";
import DrawRoundedIcon from "@mui/icons-material/DrawRounded";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";

export const SIDE_NAV_WIDTH = 240;

const NAV_ITEMS = [
  { label: "電子簽列表", href: "/forms", icon: <ListAltRoundedIcon /> },
  { label: "我的電子簽", href: "/my-signature", icon: <DrawRoundedIcon /> },
  { label: "歷史匯出文件", href: "/export-history", icon: <HistoryRoundedIcon />, adminOnly: true },
];

/** isAdmin：顯示管理者專用的選項 */
export default function SideNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: SIDE_NAV_WIDTH,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: SIDE_NAV_WIDTH,
          boxSizing: "border-box",
          bgcolor: "navBg",
          color: "common.white",
          borderRight: 0,
        },
      }}
    >
      <Toolbar>
        <Typography variant="sectionTitle" component="div" noWrap sx={{ color: "common.white" }}>
          電子簽署
        </Typography>
      </Toolbar>
      {/* 深色底上 divider token（黑色 12%）看不見，改用白色 12% */}
      <Divider sx={(theme) => ({ borderColor: alpha(theme.palette.common.white, 0.12) })} />
      <List component="nav" sx={{ px: 1 }}>
        {NAV_ITEMS.filter((item) => isAdmin || !("adminOnly" in item)).map((item) => (
          <ListItemButton
            key={item.href}
            component={Link}
            href={item.href}
            selected={pathname.startsWith(item.href)}
            sx={(theme) => ({
              borderRadius: 1,
              mb: 0.5,
              "&:hover": { bgcolor: alpha(theme.palette.common.white, 0.08) },
              "&.Mui-selected, &.Mui-selected:hover": {
                bgcolor: "primary.main",
                color: "primary.contrastText",
              },
            })}
          >
            <ListItemIcon sx={{ color: "inherit", minWidth: 40 }}>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  );
}
