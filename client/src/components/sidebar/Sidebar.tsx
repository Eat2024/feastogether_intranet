"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import { alpha, type Theme } from "@mui/material/styles";
import MenuIcon from "@mui/icons-material/Menu";
import ServiceSwitcher from "./ServiceSwitcher";
import SidebarMiniNavigation from "./SidebarMiniNavigation";
import SidebarNavigation from "./SidebarNavigation";
import { SIDEBAR_OPEN_COOKIE } from "./constants";
import { getCurrentService } from "./services";

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
  const service = getCurrentService(pathname);

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
          flexDirection: open ? "row" : "column",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 1,
          borderBottom: "1px solid",
          borderBottomColor: alpha(theme.palette.common.white, 0.12),
        })}
      >
        {open ? (
          <>
            <ServiceSwitcher current={service} compact={false} />
            {toggle}
          </>
        ) : (
          <>
            {toggle}
            <ServiceSwitcher current={service} compact />
          </>
        )}
      </Box>
      {open ? (
        <SidebarNavigation items={service.menu} pathname={pathname} />
      ) : (
        <SidebarMiniNavigation items={service.menu} pathname={pathname} />
      )}
    </Drawer>
  );
}
