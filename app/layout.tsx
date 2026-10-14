import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "星核脉冲爱心";
const description = "由粒子构成、会呼吸和自愈的交互式三维爱心。";

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#080107",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const image = `${origin}/og-card.png`;

  return {
    metadataBase: new URL(origin),
    title,
    description,
    applicationName: "Cosmic Pulse Heart",
    category: "interactive art",
    alternates: { canonical: origin },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      url: origin,
      siteName: "星核脉冲爱心",
      title,
      description,
      images: [
        {
          url: image,
          width: 1731,
          height: 909,
          alt: "玫红与金色构成的三维粒子爱心",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
