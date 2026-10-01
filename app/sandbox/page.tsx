import type { Metadata } from "next";
import SandboxClient from "./SandboxClient";

export const metadata: Metadata = {
  title: "Sandbox · Browser Linux",
};

export default function SandboxPage() {
  return <SandboxClient />;
}
