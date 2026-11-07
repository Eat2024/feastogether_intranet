'use client';

import { deleteSession } from '@/api/requests';
import { clearInternalIdentityCache } from '@/features/navigation/authorization-cache';
import { useCurrentAuthMe } from '@/features/navigation/InternalIdentityBoundary';
import ArrowDropDownOutlinedIcon from '@mui/icons-material/ArrowDropDownOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type MouseEvent } from 'react';

/** 與驗收系統一致的共用使用者選單；不為不同 actor 建立專用提示元件。 */
export default function UserProfile() {
  const queryClient = useQueryClient();
  const session = useCurrentAuthMe();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const displayName = 'displayName' in session.actor
    ? session.actor.displayName
    : session.user?.name ?? '-';
  const empId = session.user?.empId ?? null;
  const logout = useMutation({
    mutationFn: deleteSession,
    onSuccess: async () => {
      await clearInternalIdentityCache(queryClient);
      window.location.replace('/');
    },
  });

  const handleOpen = (event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);
  const handleLogout = () => {
    logout.mutate();
    handleClose();
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0 }}>
      <Avatar>{displayName.slice(0, 2).toUpperCase()}</Avatar>
      <Box sx={{ ml: 1.5 }}>
        <Typography variant="body1">{displayName}</Typography>
        {empId && <Typography variant="body2" color="text.secondary">{empId}</Typography>}
      </Box>
      <IconButton onClick={handleOpen} aria-label="開啟使用者選單">
        <ArrowDropDownOutlinedIcon />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
      >
        <MenuItem onClick={handleLogout} disabled={logout.isPending || logout.isSuccess}>
          <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
          登出
        </MenuItem>
      </Menu>
    </Box>
  );
}
