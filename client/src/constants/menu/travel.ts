import type { SvgIconComponent } from "@mui/icons-material";
import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import CampaignRoundedIcon from "@mui/icons-material/CampaignRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import HowToRegRoundedIcon from "@mui/icons-material/HowToRegRounded";
import HowToVoteRoundedIcon from "@mui/icons-material/HowToVoteRounded";
import type { NavItem, NavSubItem } from "@/components/sidebar/services";
import { TRAVEL_ROUTES } from "@/constants/routes/travel";

type TravelRoute = (typeof TRAVEL_ROUTES)[keyof typeof TRAVEL_ROUTES];

const getLastPathSegment = (path: string) => path.split("/").filter(Boolean).pop() ?? "";

const toSubItem = (route: TravelRoute): NavSubItem => ({
  key: getLastPathSegment(route.href),
  label: route.label,
  href: route.href,
});

const toGroup = (route: TravelRoute, icon: SvgIconComponent, children: TravelRoute[]): NavItem => ({
  ...toSubItem(route),
  icon,
  children: children.map(toSubItem),
});

/** 旅遊平台側邊欄選單（比照 CKS_Acceptance_System 的 constants/menu.ts，由 TRAVEL_ROUTES 組成） */
export const travelMenu: NavItem[] = [
  {
    key: "home",
    label: TRAVEL_ROUTES.home.label,
    href: TRAVEL_ROUTES.home.href,
    icon: HomeRoundedIcon,
    // 其他頁面都在 /travel 底下，首頁只在完全相同時算目前頁
    exact: true,
  },
  toGroup(TRAVEL_ROUTES.permissionManagement, AdminPanelSettingsRoundedIcon, [
    TRAVEL_ROUTES.roleManagement,
    TRAVEL_ROUTES.accountManagement,
    TRAVEL_ROUTES.operationLogs,
  ]),
  toGroup(TRAVEL_ROUTES.myTravel, EventRoundedIcon, [
    TRAVEL_ROUTES.tripRegistration,
    TRAVEL_ROUTES.myItineraries,
    TRAVEL_ROUTES.personalAndDependentInfo,
  ]),
  toGroup(TRAVEL_ROUTES.votingManagement, HowToVoteRoundedIcon, [
    TRAVEL_ROUTES.votingEventSettings,
    TRAVEL_ROUTES.tripVoting,
  ]),
  toGroup(TRAVEL_ROUTES.registrationManagement, HowToRegRoundedIcon, [
    TRAVEL_ROUTES.registrationSettings,
    TRAVEL_ROUTES.tripSessionManagement,
    TRAVEL_ROUTES.departureLocationManagement,
    TRAVEL_ROUTES.formDownloads,
    TRAVEL_ROUTES.registrationOrderQuery,
    TRAVEL_ROUTES.batchDownloadHistory,
  ]),
  toGroup(TRAVEL_ROUTES.contentManagement, CampaignRoundedIcon, [
    TRAVEL_ROUTES.noticeAndConsentManagement,
    TRAVEL_ROUTES.standardContractManagement,
    TRAVEL_ROUTES.downloadFormManagement,
    TRAVEL_ROUTES.registerFormManagement,
    TRAVEL_ROUTES.emailManagement,
  ]),
];
