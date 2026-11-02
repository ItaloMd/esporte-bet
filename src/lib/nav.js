import {
  Home, CircleDot, Ticket, Gift, UserRound, Settings, Wallet,
} from "lucide-react";

export const NAV_ITEMS = [
  { path: "/", label: "Início", icon: Home },
  { path: "/esportes", label: "Futebol", icon: CircleDot },
  { path: "/competicoes", label: "Competições", icon: Ticket },
  { path: "/minhas-simulacoes", label: "Minhas simulações", icon: Ticket },
  { path: "/carteira", label: "Carteira", icon: Wallet },
  { path: "/indique-e-ganhe", label: "Indique e ganhe", icon: Gift },
  { path: "/perfil", label: "Perfil", icon: UserRound },
  { path: "/configuracoes", label: "Configurações", icon: Settings },
];

export const BOTTOM_ITEMS = [
  { path: "/", label: "Início", icon: Home },
  { path: "/competicoes", label: "Competições", icon: CircleDot },
  { path: "/minhas-simulacoes", label: "Apostas", icon: Ticket },
  { path: "/carteira", label: "Carteira", icon: Wallet },
  { path: "/perfil", label: "Perfil", icon: UserRound },
];