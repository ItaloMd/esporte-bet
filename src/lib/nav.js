import {
  Home, CircleDot, Radio, BarChart3,
  Ticket, Gift, UserRound, Settings, Wallet,
} from "lucide-react";

export const NAV_ITEMS = [
  { path: "/", label: "Início", icon: Home },
  { path: "/esporte/futebol", label: "Futebol", icon: CircleDot },
  { path: "/ao-vivo", label: "Ao vivo", icon: Radio },
  { path: "/competicoes", label: "Competições", icon: BarChart3 },
  { path: "/minhas-simulacoes", label: "Minhas simulações", icon: Ticket },
  { path: "/carteira", label: "Carteira", icon: Wallet },
  { path: "/indique-e-ganhe", label: "Indique e ganhe", icon: Gift },
  { path: "/perfil", label: "Perfil", icon: UserRound },
  { path: "/configuracoes", label: "Configurações", icon: Settings },
];

export const BOTTOM_ITEMS = [
  { path: "/", label: "Início", icon: Home },
  { path: "/esportes", label: "Esportes", icon: CircleDot },
  { path: "/ao-vivo", label: "Ao vivo", icon: Radio },
  { path: "/minhas-simulacoes", label: "Simulações", icon: Ticket },
  { path: "/perfil", label: "Perfil", icon: UserRound },
];