export const validCommunityCatalog = {
  schemaVersion: 1,
  catalogRevision: "1".repeat(40),
  themes: [{
    id: "mountain-mist-community",
    localized: {
      "zh-CN": {
        name: "山峦云海社区版",
        summary: "面向社区目录的示例主题",
        description: "用于验证社区主题目录契约。",
      },
      en: {
        name: "Mountain Mist Community",
        summary: "Example theme for the community directory",
        description: "Validates the community catalog contract.",
      },
    },
    author: {
      name: "OpenChatGPTSkin Community",
      github: "u2bo",
      homepage: "https://github.com/u2bo",
    },
    tags: ["landscape", "light"],
    featured: true,
    latestVersion: "1.0.0",
    rightsDeclaration: "author-self-declared",
    versions: [{
      version: "1.0.0",
      themeSchemaVersion: 4,
      minimumAppVersion: "0.3.2",
      lastVerifiedAppVersion: "0.3.2",
      supportStatus: "verified",
      releasedAt: "2026-07-29T00:00:00.000Z",
      changelog: {
        "zh-CN": "首次发布。",
        en: "Initial release.",
      },
      preview: {
        kind: "cover",
        url: "https://u2bo.github.io/OpenChatGPTSkin-Community/media/mountain-mist-community/1.0.0/preview.webp",
        contentType: "image/webp",
        bytes: 524288,
        sha256: "2".repeat(64),
        width: 1600,
        height: 900,
      },
      screenshots: [{
        kind: "home",
        url: "https://u2bo.github.io/OpenChatGPTSkin-Community/media/mountain-mist-community/1.0.0/home.webp",
        contentType: "image/webp",
        bytes: 1048576,
        sha256: "3".repeat(64),
        width: 1920,
        height: 1080,
      }, {
        kind: "task",
        url: "https://u2bo.github.io/OpenChatGPTSkin-Community/media/mountain-mist-community/1.0.0/task.webp",
        contentType: "image/webp",
        bytes: 1048576,
        sha256: "4".repeat(64),
        width: 1920,
        height: 1080,
      }],
      archive: {
        url: "https://github.com/u2bo/OpenChatGPTSkin-Community/releases/download/mountain-mist-community-v1.0.0/mountain-mist-community-1.0.0.ocskin",
        bytes: 2097152,
        sha256: "5".repeat(64),
      },
      yankedReason: null,
    }],
  }],
} as const;

export function cloneValidCommunityCatalog(): unknown {
  return structuredClone(validCommunityCatalog);
}
