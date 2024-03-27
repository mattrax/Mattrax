import { Badge } from "@mattrax/ui";
import { match } from "ts-pattern";

export const BruhIconLogosMicrosoftWindowsIcon = () => (
	<IconLogosMicrosoftWindowsIcon />
);

export const BruhIconLogosMacos = () => <IconLogosMacos />;

export const BruhIconLogosIos = () => <IconLogosIos />;

export const BruhIconLogosAndroidIcon = () => <IconLogosAndroidIcon />;

export const BruhIconLogosLinuxTux = () => <IconLogosLinuxTux />;

export const BruhIconPhArrowsVerticalBold = () => <IconPhArrowsVerticalBold />;

export const BruhIconPhUser = () => <IconPhUser />;

export const BruhIconPhDevices = () => <IconPhDevices />;

export const BruhIconPhPuzzlePiece = () => <IconPhPuzzlePiece />;

export function renderStatusBadge(status: "deploying" | "deployed") {
	return match(status)
		.with("deployed", () => <Badge variant="success">Deployed</Badge>)
		.with("deploying", () => <Badge class="animate-pulse">Deploying</Badge>)
		.exhaustive();
}
