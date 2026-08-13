import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "光学仿真实验平台",
  description: "面向大学基础物理光学课堂的交互式仿真平台——高斯光束追踪 | 矢量衍射仿真 | 偏振琼斯分析",
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
        className="antialiased"
        style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif" }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
