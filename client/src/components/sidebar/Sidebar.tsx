"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import MenuIcon from "@mui/icons-material/Menu";
import ServiceSwitcher from "./ServiceSwitcher";
import SidebarMiniNavigation from "./SidebarMiniNavigation";
import SidebarNavigation from "./SidebarNavigation";
import { SIDEBAR_OPEN_COOKIE } from "./constants";
import { getCurrentService } from "./services";
import { useVisibleNavigation } from "@/features/navigation/useVisibleNavigation";

const SIDEBAR_WIDTH_OPEN = 240;
// 收合寬度為 theme.spacing(SIDEBAR_SPACING_CLOSED)，需容納圖示下方的短標籤
const SIDEBAR_SPACING_CLOSED = 12;

const sidebarWidth = (theme: Theme, open: boolean) => ({
  width: open ? SIDEBAR_WIDTH_OPEN : theme.spacing(SIDEBAR_SPACING_CLOSED),
  transition: theme.transitions.create("width", {
    easing: theme.transitions.easing.sharp,
    duration: open
      ? theme.transitions.duration.enteringScreen
      : theme.transitions.duration.leavingScreen,
  }),
});

type Props = {
  /** 伺服器端由 cookie 讀出的收合狀態 */
  defaultOpen: boolean;
};

/** 全站側邊欄：頂端切換服務，下方為目前服務的選單；可收合為圖示模式（關閉瀏覽器前記住狀態） */
export default function Sidebar({ defaultOpen }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(defaultOpen);
  const navigation = useVisibleNavigation(pathname);
  const service = navigation.status === "ready"
    ? getCurrentService(pathname, navigation.services)
    : undefined;

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    // 不設期限：關閉瀏覽器即恢復展開
    document.cookie = `${SIDEBAR_OPEN_COOKIE}=${next}; path=/; SameSite=Lax`;
  };

  const toggle = (
    <IconButton
      onClick={handleToggle}
      aria-label={open ? "收合側邊選單" : "展開側邊選單"}
      sx={{ color: "common.white" }}
    >
      <MenuIcon />
    </IconButton>
  );

  return (
    <Drawer
      variant="permanent"
      // 被入口網 iframe 嵌入時由 globals.css 隱藏（見 app/layout.tsx 的 data-embedded）
      className="hide-when-embedded"
      sx={(theme) => ({
        ...sidebarWidth(theme, open),
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          ...sidebarWidth(theme, open),
          boxSizing: "border-box",
          overflowX: "hidden",
          bgcolor: "navBg",
          color: "common.white",
          borderRight: 0,
        },
      })}
    >
      <Box
        sx={(theme) => ({
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          // 收合時兩顆圖示按鈕並排，縮小間距才放得進收合寬度
          gap: open ? 1 : 0.5,
          px: open ? 1 : 0.5,
          py: 1,
          borderBottom: "1px solid",
          borderBottomColor: alpha(theme.palette.common.white, 0.12),
        })}
      >
        {service ? (
          <ServiceSwitcher current={service} services={navigation.services} compact={!open} />
        ) : <Box sx={{ flex: 1 }} />}
        {toggle}
      </Box>
      {service && (open ? (
        <SidebarNavigation items={service.menu} pathname={pathname} />
      ) : (
        <SidebarMiniNavigation items={service.menu} pathname={pathname} />
      ))}
      {open && navigation.status === "loading" && (
        <Stack direction="row" spacing={1.5} sx={{ p: 2, alignItems: "center" }}>
          <CircularProgress size={18} color="inherit" />
          <Typography variant="description" color="inherit">載入可用功能中…</Typography>
        </Stack>
      )}
      {open && navigation.status === "error" && (
        <Stack spacing={1.5} sx={{ p: 2, alignItems: "flex-start" }}>
          <Typography variant="description" color="inherit">
            {navigation.offline ? "目前離線，重新連線後再試" : "無法取得功能權限，請重試"}
          </Typography>
          <Button color="inherit" variant="outlined" size="small" onClick={navigation.retry} loading={navigation.retrying}>
            重新取得
          </Button>
        </Stack>
      )}
      {open && navigation.status === "empty" && (
        <Typography variant="description" color="inherit" sx={{ p: 2 }}>
          目前沒有可使用的功能
        </Typography>
      )}
    </Drawer>
  );
}
