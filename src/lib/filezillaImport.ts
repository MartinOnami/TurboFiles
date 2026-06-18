/**
 * Parse a FileZilla `sitemanager.xml` export into TurboFiles site records.
 *
 * FileZilla stores sites under `<FileZilla3><Servers>…`. Each `<Server>` holds
 * the connection fields as child elements, with the visible site name as a
 * trailing text node. Passwords are base64-encoded. This is best-effort: the
 * common FTP/SFTP/FTPS + normal/anonymous/key cases are covered.
 */
import type { FtpEncryption, LogonType, Protocol, Site } from "./types";

export interface ImportedSite {
  site: Omit<Site, "id" | "createdAt" | "updatedAt" | "hasStoredSecret">;
  password?: string;
}

function text(server: Element, tag: string): string {
  return server.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
}

/** The site name is the trailing text node of <Server> (not an element). */
function serverName(server: Element): string {
  let name = "";
  server.childNodes.forEach((n) => {
    if (n.nodeType === 3 /* TEXT_NODE */) {
      const t = (n.textContent ?? "").trim();
      if (t) name = t;
    }
  });
  return name;
}

/** Map FileZilla's numeric protocol to ours (best-effort). */
function mapProtocol(code: string): { protocol: Protocol; encryption?: FtpEncryption } {
  switch (code) {
    case "1":
      return { protocol: "sftp" };
    case "3":
      return { protocol: "ftps", encryption: "require_implicit_tls" }; // FTPS implicit
    case "4":
      return { protocol: "ftp", encryption: "require_explicit_tls" }; // FTPES explicit
    default:
      return { protocol: "ftp", encryption: "plain" }; // 0 = FTP
  }
}

/** Map FileZilla's numeric logon type to ours. */
function mapLogon(code: string): LogonType {
  switch (code) {
    case "0":
      return "anonymous";
    case "3":
      return "interactive";
    case "5":
    case "6":
      return "key"; // key file / key+agent
    default:
      return "normal";
  }
}

function decodePass(server: Element): string | undefined {
  const el = server.getElementsByTagName("Pass")[0];
  if (!el) return undefined;
  const raw = el.textContent ?? "";
  if (!raw) return undefined;
  if (el.getAttribute("encoding") === "base64") {
    try {
      return atob(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}

export function parseFileZillaSites(xml: string): ImportedSite[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Not a valid FileZilla sitemanager.xml file");
  }
  const out: ImportedSite[] = [];
  const servers = Array.from(doc.getElementsByTagName("Server"));
  for (const server of servers) {
    const host = text(server, "Host");
    if (!host) continue;
    const { protocol, encryption } = mapProtocol(text(server, "Protocol"));
    const logonType = mapLogon(text(server, "Logontype"));
    const port = parseInt(text(server, "Port"), 10);
    const keyPath = text(server, "Keyfile");
    const remoteDir = text(server, "RemoteDir");
    const localDir = text(server, "LocalDir");
    out.push({
      site: {
        name: serverName(server) || `${text(server, "User") || "anonymous"}@${host}`,
        protocol,
        host,
        port: Number.isFinite(port) && port > 0 ? port : protocol === "sftp" ? 22 : 21,
        username: logonType === "anonymous" ? "anonymous" : text(server, "User"),
        logonType,
        ftpEncryption: protocol === "ftp" || protocol === "ftps" ? encryption : undefined,
        privateKeyPath: logonType === "key" && keyPath ? keyPath : undefined,
        defaultRemotePath: remoteDir || undefined,
        defaultLocalPath: localDir || undefined,
      },
      password: logonType === "anonymous" ? undefined : decodePass(server),
    });
  }
  return out;
}
