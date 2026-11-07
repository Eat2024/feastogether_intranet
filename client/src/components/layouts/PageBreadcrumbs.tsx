'use client';

import { getBreadcrumbItems } from '@/constants/routes';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';

export default function PageBreadcrumbs() {
  const pathname = usePathname();
  const breadcrumbs = getBreadcrumbItems(pathname);
  return (
    <Breadcrumbs aria-label="breadcrumb" sx={{ minWidth: 200 }}>
      {breadcrumbs.map((item, index) => {
        const current = index === breadcrumbs.length - 1;
        return current ? (
          <Typography key={item.href} variant="secondary" color="text.primary">
            {item.label}
          </Typography>
        ) : (
          <Link key={item.href} component={NextLink} href={item.href} color="inherit">
            {item.label}
          </Link>
        );
      })}
    </Breadcrumbs>
  );
}
