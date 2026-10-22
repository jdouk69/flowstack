import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"Flowstack",description:"Private document workflows and PDF merging."};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
