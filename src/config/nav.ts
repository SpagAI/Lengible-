import { Home, BookOpen, FolderOpen, ListChecks, Layers, Pill, BarChart3, Stethoscope, type LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
  // Shown in the phone's bottom bar; the rest live under "More".
  primary?: boolean;
  disabled?: boolean;
  note?: string;
};

export const navItems: NavItem[] = [
  { href: "/", label: "Home", short: "Home", icon: Home, primary: true },
  { href: "/courses", label: "Courses", short: "Courses", icon: BookOpen, primary: true },
  { href: "/library", label: "Library", short: "Library", icon: FolderOpen, primary: true },
  { href: "/quiz", label: "Quiz", short: "Quiz", icon: ListChecks, primary: true },
  { href: "/drugs", label: "Drugs", short: "Drugs", icon: Pill, primary: true },
  { href: "/flashcards", label: "Flashcards", short: "Cards", icon: Layers },
  { href: "/progress", label: "Progress", short: "Progress", icon: BarChart3 },
  { href: "/clinic", label: "Emiloju (Clinic)", short: "Clinic", icon: Stethoscope, disabled: true, note: "Coming soon" },
];
