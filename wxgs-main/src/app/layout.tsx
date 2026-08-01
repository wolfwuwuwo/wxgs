import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "光学仿真实验平台",
  description: "面向大学基础物理光学课堂的交互式仿真平台——17 个实验模块：几何光学(光线追迹/棱镜/像差/望远镜/显微镜) | 物理光学(琼斯偏振/矢量衍射/旋光/应力/液晶/干涉) | 现代光学(高斯光束/光纤/傅里叶4f/谐振腔/光子晶体)",
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${ibmPlexSans.variable} antialiased`}
        style={{ fontFamily: "var(--font-ibm-plex-sans), system-ui, sans-serif" }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
