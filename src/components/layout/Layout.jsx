import React, { useEffect } from "react";
import { Outlet } from "react-router-dom";
import TopBar from "@/components/layout/TopBar";
import BottomNav from "@/components/layout/BottomNav";
import SlipDock from "@/components/slip/SlipDock";
import { SlipProvider } from "@/lib/SlipProvider";
import { WalletProvider } from "@/lib/WalletProvider";
import { captureReferral } from "@/lib/referral";

export default function Layout() {
  useEffect(() => {
    captureReferral();
  }, []);

  return (
    <SlipProvider>
      <WalletProvider>
        <div className="min-h-screen">
          <TopBar />
          <main className="mx-auto w-full max-w-[1320px] px-3 pb-28 pt-4 md:px-6 md:pb-16 md:pt-5">
            <Outlet />
          </main>
          <BottomNav />
          <SlipDock />
        </div>
      </WalletProvider>
    </SlipProvider>
  );
}