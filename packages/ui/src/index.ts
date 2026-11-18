/**
 * @mattrax/ui — the dashboard's opinionated component library.
 *
 * Behaviour comes from ui-sdk; surfaces, type, spacing and motion are ours.
 * Import the stylesheet once from the app entry: `@mattrax/ui/styles.css`.
 */

export { Badge, badgeVariants, type BadgeProps } from "./badge";

export { Button, buttonVariants, type ButtonProps } from "./button";

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardLabel,
  CardTitle,
} from "./card";

export { Checkbox, CheckboxField, Switch } from "./controls";

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

export { Alert, Breadcrumb, EmptyState, type AlertTone } from "./feedback";

export {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleCheck,
  Eye,
  EyeOff,
  Filter,
  Info,
  Plus,
  Search,
  TriangleAlert,
  X,
} from "./icons";

export {
  defaultFilter,
  FilterBar,
  filterOperatorLabel,
  filterOperators,
  filterValueLabel,
  type FilterBarProps,
  type FilterCondition,
  type FilterField,
  type FilterFieldKind,
  type FilterOperator,
  type FilterOption,
} from "./filter";

export { Field, FieldError, FieldHint, Input, Label, Textarea } from "./input";

export { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./menu";

export {
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderBody,
  PageTitle,
  Stat,
} from "./page";

export { PasswordInput, type PasswordInputProps } from "./password-input";

export { Avatar, Kbd, Separator, Skeleton } from "./primitives";

export {
  NativeSelect,
  Select,
  SelectChevron,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./select";

export { SegmentedControl, SegmentedControlItem } from "./segmented-control";

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";

export { Spinner } from "./spinner";

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

export { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "./tabs";

export { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export { cn } from "./lib/cn";
