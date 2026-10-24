import { Workspace } from "@/components/shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Workspace>{children}</Workspace>;
}
