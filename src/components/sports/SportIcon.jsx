import React from "react";
import { CircleDot, Trophy, Swords, Flag, Shield, Activity, Dumbbell } from "lucide-react";

const ICONS = {
  futebol: CircleDot,
  basquete: Activity,
  tenis: Trophy,
  volei: Dumbbell,
  "futebol-americano": Shield,
  mma: Swords,
  automobilismo: Flag,
  outros: CircleDot,
};

export default function SportIcon({ slug, className = "h-4 w-4" }) {
  const Icon = ICONS[slug] || CircleDot;
  return <Icon className={className} aria-hidden="true" />;
}