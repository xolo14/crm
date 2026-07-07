import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { applyRouteMeta } from "@/lib/seo";

/** Sets document title, robots, and canonical per route (CRM = noindex except /apply & /verify). */
export default function RouteSeo() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    applyRouteMeta(pathname, search);
  }, [pathname, search]);

  return null;
}
