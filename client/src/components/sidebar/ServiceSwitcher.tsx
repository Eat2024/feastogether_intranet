"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import { SERVICES, getServiceHomeHref, type ServiceDefinition } from "./services";

type Props = {
  current: ServiceDefinition;
  /** 側邊欄收合時只顯示服務圖示 */
  compact: boolean;
};

/** 側邊欄頂端的服務切換；只有一個服務時只顯示名稱，不提供選單 */
export default function ServiceSwitcher({ current, compact }: Props) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const switchable = SERVICES.length > 1;
  const Icon = current.icon;

  const openMenu = (event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const closeMenu = () => setAnchorEl(null);
  const menuOpen = Boolean(anchorEl);

  const trigger = compact ? (
    <Tooltip title={switchable ? `切換服務（目前：${current.name}）` : current.name} placement="right">
      <IconButton
        onClick={switchable ? openMenu : undefined}
        aria-label={`切換服務，目前為${current.name}`}
        aria-haspopup={switchable ? "menu" : undefined}
        aria-expanded={switchable ? menuOpen : undefined}
        sx={{ color: "common.white" }}
      >
        <Icon />
      </IconButton>
    </Tooltip>
  ) : (
    <ButtonBase
      onClick={switchable ? openMenu : undefined}
      disabled={!switchable}
      aria-label={`切換服務，目前為${current.name}`}
      aria-haspopup={switchable ? "menu" : undefined}
      aria-expanded={switchable ? menuOpen : undefined}
      sx={(theme) => ({
        flex: 1,
        minWidth: 0,
        justifyContent: "flex-start",
        gap: 1.5,
        px: 1,
        py: 1,
        borderRadius: 1,
        color: "common.white",
        "&:hover": { bgcolor: alpha(theme.palette.common.white, 0.08) },
      })}
    >
      <Icon />
      <Typography variant="subheading" noWrap sx={{ color: "inherit", flex: 1, textAlign: "left" }}>
        {current.name}
      </Typography>
      {switchable && <ArrowDropDownIcon />}
    </ButtonBase>
  );

  return (
    <>
      {trigger}
      {switchable && (
        <Menu
          anchorEl={anchorEl}
          open={menuOpen}
          onClose={closeMenu}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          slotProps={{ paper: { sx: { minWidth: 200 } } }}
        >
          {SERVICES.map((service) => {
            const ServiceIcon = service.icon;
            const selected = service.key === current.key;
            return (
              <MenuItem
                key={service.key}
                component={Link}
                href={getServiceHomeHref(service)}
                selected={selected}
                onClick={closeMenu}
              >
                <ListItemIcon>
                  <ServiceIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={service.name} />
                {selected && <CheckRoundedIcon fontSize="small" color="primary" sx={{ ml: 2 }} />}
              </MenuItem>
            );
          })}
        </Menu>
      )}
    </>
  );
}
