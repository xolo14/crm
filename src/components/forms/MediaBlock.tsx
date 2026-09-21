/** Image / video content blocks (Google Forms "Add image" / "Add video"). */

export type MediaAlign = "left" | "center" | "right";

export type MediaBlockData = {
  url: string;
  caption?: string;
  align?: MediaAlign;
  /** Percentage of the card width, 20–100. */
  widthPct?: number;
};

/** Turn a YouTube / Vimeo / Loom / Drive share link into an embeddable player URL. */
export function toVideoEmbedUrl(raw: string): string {
  const url = String(raw || "").trim();
  if (!url) return "";
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : "";
    }
    if (host.endsWith("youtube.com")) {
      if (u.pathname.startsWith("/embed/")) return `https://www.youtube-nocookie.com${u.pathname}`;
      if (u.pathname.startsWith("/shorts/")) {
        const id = u.pathname.split("/")[2];
        return id ? `https://www.youtube-nocookie.com/embed/${id}` : "";
      }
      const id = u.searchParams.get("v");
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : "";
    }
    if (host === "vimeo.com" || host.endsWith(".vimeo.com")) {
      if (host === "player.vimeo.com") return url;
      const id = u.pathname.split("/").filter(Boolean).pop();
      return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : "";
    }
    if (host.endsWith("loom.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      return id ? `https://www.loom.com/embed/${id}` : "";
    }
    if (host === "drive.google.com") {
      const m = u.pathname.match(/\/file\/d\/([^/]+)/);
      return m ? `https://drive.google.com/file/d/${m[1]}/preview` : "";
    }
    if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(u.pathname)) return url; // direct file → <video>
  } catch {
    return "";
  }
  return "";
}

export function isDirectVideoFile(url: string): boolean {
  return /\.(mp4|webm|ogg)(\?.*)?$/i.test(String(url || "").split("?")[0]);
}

type Props = {
  kind: "image" | "video";
  data: MediaBlockData;
  title?: string;
  className?: string;
};

export function MediaBlock({ kind, data, title, className = "" }: Props) {
  const align = data.align || "center";
  const widthPct = Math.min(100, Math.max(20, Number(data.widthPct) || 100));
  const justify = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  const url = String(data.url || "").trim();

  if (!url) {
    return (
      <div className={`sp-form-media sp-form-media--empty ${className}`.trim()}>
        {kind === "image" ? "Image not set" : "Video not set"}
      </div>
    );
  }

  return (
    <figure className={`sp-form-media ${className}`.trim()} style={{ justifyContent: justify }}>
      <div className="sp-form-media-inner" style={{ width: `${widthPct}%` }}>
        {title ? <figcaption className="sp-form-media-title">{title}</figcaption> : null}
        {kind === "image" ? (
          <img src={url} alt={data.caption || title || ""} loading="lazy" decoding="async" />
        ) : isDirectVideoFile(url) ? (
          <video src={url} controls preload="metadata" />
        ) : (
          <div className="sp-form-media-frame">
            <iframe
              src={toVideoEmbedUrl(url) || url}
              title={title || "Video"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        )}
        {data.caption ? <figcaption className="sp-form-media-caption">{data.caption}</figcaption> : null}
      </div>
    </figure>
  );
}
