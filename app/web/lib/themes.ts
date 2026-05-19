export type SidebarThemeName = "blue" | "light";
export type ColorModeName = "light" | "dark" | "system";

export interface SidebarThemeConfig {
  aside: string;
  container: string;
  brand: {
    wrapper: string;
    iconBox: string;
    title: string;
    subtitle: string;
    subtitleDot?: string;
  };
  nav: {
    wrapper: string;
    item: string;
    itemActive: string;
    itemInactive: string;
    iconWrapper?: string;
    iconWrapperActive?: string;
    iconWrapperInactive?: string;
    iconSize: string;
    badgeActive: string;
    badgeInactive: string;
  };
  footer: {
    card: string;
    title: string;
    subtitle: string;
    aiBox: string;
    progressBar?: string;
    progressFill?: string;
    copyright: string;
  };
  contentArea: {
    wrapper: string;
    header: string;
    main: string;
  };
}

export const sidebarThemes: Record<SidebarThemeName, SidebarThemeConfig> = {
  blue: {
    aside: "fixed left-0 top-0 z-50 hidden h-screen w-60 lg:block",
    container:
      "flex h-full flex-col bg-gradient-to-b from-[#172554] to-[#2e1065] text-slate-200 shadow-2xl",
    brand: {
      wrapper: "flex items-center gap-3 border-b border-white/10 px-6 py-7",
      iconBox: "flex size-10 items-center justify-center rounded-lg bg-blue-500 text-white",
      title: "text-lg font-bold leading-tight text-white whitespace-nowrap",
      subtitle: "mt-1 text-[11px] font-medium text-blue-200 whitespace-nowrap",
    },
    nav: {
      wrapper: "flex flex-1 flex-col gap-2 px-3 py-6",
      item: "flex items-center justify-between rounded-lg px-4 py-3 text-sm transition-all duration-150",
      itemActive: "border-l-4 border-blue-400 bg-white/10 font-semibold text-white backdrop-blur",
      itemInactive: "text-slate-300 hover:bg-white/5 hover:text-white",
      iconSize: "size-5",
      badgeActive: "bg-blue-500/20 text-blue-100",
      badgeInactive: "bg-blue-500/20 text-blue-100",
    },
    footer: {
      card: "overflow-hidden rounded-xl border border-blue-400/20 bg-blue-600/20 p-4 text-center",
      title: "text-sm font-bold text-white",
      subtitle: "mt-1 text-xs text-blue-200",
      aiBox:
        "mx-auto mt-4 flex size-16 items-center justify-center rounded-lg border border-blue-300/30 bg-blue-500/20 text-2xl font-bold text-blue-200",
      copyright: "mt-4 text-center text-xs text-slate-500",
    },
    contentArea: {
      wrapper: "flex h-full min-h-0 flex-col lg:pl-60",
      header:
        "sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/90 px-4 shadow-sm backdrop-blur lg:px-8",
      main: "flex min-h-0 flex-1 flex-col min-w-0 overflow-y-auto p-4 lg:p-6",
    },
  },

  light: {
    aside: "fixed left-4 top-4 z-50 hidden h-[calc(100vh-2rem)] w-56 lg:block",
    container:
      "flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_52%,#f5f7fb_100%)] text-slate-700 shadow-[0_18px_42px_rgba(15,23,42,0.10)] dark:bg-[linear-gradient(180deg,#111827_0%,#0f172a_52%,#111827_100%)] dark:text-slate-200 dark:shadow-[0_18px_42px_rgba(0,0,0,0.32)]",
    brand: {
      wrapper: "flex items-center gap-3 border-b border-border px-4 py-5",
      iconBox:
        "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-accent text-primary shadow-sm",
      title: "whitespace-nowrap text-base font-semibold tracking-normal text-foreground",
      subtitle: "mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted",
      subtitleDot: "size-1.5 rounded-full bg-cyan-500",
    },
    nav: {
      wrapper: "flex flex-1 flex-col gap-1.5 px-3 py-5",
      item: "group flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-sm transition-all duration-150",
      itemActive: "border-border bg-accent font-semibold text-primary shadow-sm",
      itemInactive:
        "border-transparent text-muted hover:border-border hover:bg-card hover:text-foreground hover:shadow-sm",
      iconWrapper: "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
      iconWrapperActive: "bg-card text-primary",
      iconWrapperInactive: "bg-secondary text-muted group-hover:bg-accent group-hover:text-primary",
      iconSize: "size-4",
      badgeActive: "bg-primary text-white",
      badgeInactive: "bg-secondary text-muted",
    },
    footer: {
      card: "overflow-hidden rounded-lg border border-border bg-card p-4 shadow-sm",
      title: "text-sm font-semibold text-foreground",
      subtitle: "mt-1 text-xs text-muted",
      aiBox:
        "flex size-10 shrink-0 items-center justify-center rounded-lg border border-cyan-100 bg-cyan-50 text-sm font-semibold text-cyan-700",
      progressBar: "mt-4 h-1 overflow-hidden rounded-full bg-secondary",
      progressFill: "h-full w-2/3 rounded-full bg-gradient-to-r from-primary to-cyan-500",
      copyright: "mt-4 text-center text-xs text-slate-400",
    },
    contentArea: {
      wrapper: "flex h-full min-h-0 flex-col lg:pl-60 lg:pt-4",
      header:
        "sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/90 px-4 shadow-sm backdrop-blur lg:top-4 lg:mx-4 lg:rounded-2xl lg:border lg:px-6 lg:shadow-[0_12px_32px_rgba(15,23,42,0.07)]",
      main: "flex min-h-0 flex-1 flex-col min-w-0 overflow-y-auto p-4 lg:p-4",
    },
  },
};
