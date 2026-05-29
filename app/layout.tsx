import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArbiCore - Arbitrage Simulator",
  description:
    "Monitor markets, detect price differences, and execute arbitrage with precision. Real-time cryptocurrency arbitrage simulation platform.",
  keywords: [
    "arbitrage",
    "cryptocurrency",
    "trading",
    "BTC",
    "simulation",
    "fintech",
  ],
};

export const viewport: Viewport = {
  themeColor: "#06284a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="bg-background">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
