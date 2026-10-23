import React, { useEffect } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import BottomNav from "@/components/layout/BottomNav";
import SlipDock from "@/components/slip/SlipDock";
import { SlipProvider } from "@/lib/SlipProvider";
import { captureReferral } from "@/lib/referral";

export default function Layout() {
  useEffect(() => {
    captureReferral();
  }, []);

  return (
    <SlipProvider>
      <div className="min-h-screen">
        <Sidebar />
        <div className="md:pl-[15.5rem]">
          <TopBar />
          <main className="mx-auto w-full max-w-6xl px-3 pb-28 pt-4 md:px-6 md:pb-16 md:pt-6">
            <Outlet />
          </main>
        </div>
        <BottomNav />
        <SlipDock />
      </div>
    </SlipProvider>
  );
}