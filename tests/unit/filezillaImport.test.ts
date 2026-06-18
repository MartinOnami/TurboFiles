import { describe, expect, it } from "vitest";
import { parseFileZillaSites } from "@/lib/filezillaImport";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FileZilla3>
  <Servers>
    <Server>
      <Host>sftp.example.com</Host>
      <Port>2222</Port>
      <Protocol>1</Protocol>
      <Logontype>1</Logontype>
      <User>deploy</User>
      <Pass encoding="base64">c2VjcmV0</Pass>
      <RemoteDir>/var/www</RemoteDir>
      My SFTP Server
    </Server>
    <Server>
      <Host>ftp.example.org</Host>
      <Port>21</Port>
      <Protocol>0</Protocol>
      <Logontype>0</Logontype>
      Anon FTP
    </Server>
  </Servers>
</FileZilla3>`;

describe("parseFileZillaSites", () => {
  it("parses SFTP site with base64 password and name", () => {
    const out = parseFileZillaSites(XML);
    expect(out).toHaveLength(2);
    const sftp = out[0];
    expect(sftp.site.protocol).toBe("sftp");
    expect(sftp.site.host).toBe("sftp.example.com");
    expect(sftp.site.port).toBe(2222);
    expect(sftp.site.username).toBe("deploy");
    expect(sftp.site.name).toBe("My SFTP Server");
    expect(sftp.site.defaultRemotePath).toBe("/var/www");
    expect(sftp.password).toBe("secret"); // base64 "c2VjcmV0"
  });

  it("parses anonymous FTP site", () => {
    const out = parseFileZillaSites(XML);
    const ftp = out[1];
    expect(ftp.site.protocol).toBe("ftp");
    expect(ftp.site.logonType).toBe("anonymous");
    expect(ftp.site.username).toBe("anonymous");
    expect(ftp.password).toBeUndefined();
  });

  it("throws on invalid XML", () => {
    expect(() => parseFileZillaSites("not xml <<<")).toThrow();
  });
});
