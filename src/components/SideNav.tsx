"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

export const SIDE_NAV_WIDTH = 240;

const NAV_ITEMS = [
  { label: "電子簽列表", href: "/forms", icon: <ListAltRoundedIcon /> },
  { label: "我的電子簽", href: "/my-signature", icon: <DrawRoundedIcon /> },
];

export default function SideNav() {
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
      <List component="nav" sx={{ px: 1 }}>
        {NAV_ITEMS.map((item) => (
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
