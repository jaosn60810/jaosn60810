const core = require("@actions/core");
const { Toolkit } = require("actions-toolkit");
const fs = require("fs");
const cheerio = require("cheerio");
const axios = require("axios");
const { spawn } = require("child_process");

// yml input
const GITHUB_TOKEN = core.getInput("GITHUB_TOKEN");
const MAX_LINES = core.getInput("MAX_LINES");
const COMMITTER_USERNAME = core.getInput("COMMITTER_USERNAME");
const COMMITTER_EMAIL = core.getInput("COMMITTER_EMAIL");
const COMMIT_MSG = core.getInput("COMMIT_MSG");

core.setSecret(GITHUB_TOKEN);

const baseUrl = "https://jaosn60810.github.io";

const exec = (cmd, args = [], options = {}) =>
  new Promise((resolve, reject) => {
    let outputData = "";
    const optionsToCLI = {
      ...options,
    };
    if (!optionsToCLI.stdio) {
      Object.assign(optionsToCLI, { stdio: ["inherit", "inherit", "inherit"] });
    }
    const app = spawn(cmd, args, optionsToCLI);
    if (app.stdout) {
      // Only needed for pipes
      app.stdout.on("data", function (data) {
        outputData += data.toString();
      });
    }

    app.on("close", (code) => {
      if (code !== 0) {
        return reject({ code, outputData });
      }
      return resolve({ code, outputData });
    });
    app.on("error", () => reject({ code: 1, outputData }));
  });

const commitReadmeFile = async () => {
  await exec("git", ["config", "--global", "user.email", COMMITTER_EMAIL]);

  if (GITHUB_TOKEN) {
    await exec("git", [
      "remote",
      "set-url",
      "origin",
      `https://${GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`,
    ]);
  }

  await exec("git", ["config", "--global", "user.name", COMMITTER_USERNAME]);
  await exec("git", ["add", "."]);
  await exec("git", ["commit", "-m", COMMIT_MSG]);
  await exec("git", ["push"]);
};

// 爬自己的技術文章目錄
async function getBlogOutline() {
  const { data } = await axios.get(
    "https://codelove.tw/api/posts?username=jason60810"
  );

  const $ = cheerio.load(data);

  const outline = [];

  const Logs = $("h1:contains('Logs')").next().children();

  Logs.each((_, el) => {
    const logDetail = {
      title: "",
      link: "",
    };

    const link = baseUrl + $(el).children().attr("href");

    logDetail.title = $(el).text();
    if (link.includes(" ")) {
      logDetail.link = link.replace(" ", "%20");
    } else {
      logDetail.link = link;
    }
    outline.push(logDetail);
  });

  const outlineFilter = outline.slice(0, MAX_LINES);

  return outlineFilter;
}

Toolkit.run(async (tools) => {
  tools.log.debug("Edit README.md Start...");

  const readmeContent = fs.readFileSync("./README.md", "utf-8").split("\n");

  //找到 START TAG
  let startIndex = readmeContent.findIndex(
    (content) => content.trim() === "<!-- UPDATE_WEISITE:START -->"
  );

  // START TAG 不存在
  if (startIndex === -1)
    return tools.exit.failure("Not Found Start Update Comments");

  let endIndex = readmeContent.findIndex(
    (content) => content.trim() === "<!-- UPDATE_WEISITE:END -->"
  );

  const outline = await getBlogOutline();

  //只有 <!-- UPDATE_WEISITE:START --> 沒有 <!-- UPDATE_WEISITE:END -->
  if (startIndex !== -1 && endIndex === -1) {
    startIndex++; //next line

    outline.forEach((o, index) => {
      readmeContent.splice(
        startIndex + index,
        0,
        `- ${o.title} [連結](${o.link})`
      );
    });

    readmeContent.splice(
      startIndex + outline.length,
      0,
      "<!-- UPDATE_WEISITE:END -->"
    );

    fs.writeFileSync("./README.md", readmeContent.join("\n"));

    try {
      // await commitReadmeFile();
      tools.log.success("Commit file success");
    } catch (error) {
      tools.log.debug("Something went wrong");
      return tools.exit.failure(error);
    }
    tools.exit.success("Wrote to README");
  }

  const oldContent = readmeContent.slice(startIndex + 1, endIndex).join("\n");
  const newContent = outline
    .map((o) => `- ${o.title} [連結](${o.link})`)
    .join("\n");

  const compareOldContent = oldContent.replace(/(?:\\[rn]|[\r\n]+)+/g, "");

  const compareNewContentt = newContent.replace(/(?:\\[rn]|[\r\n]+)+/g, "");

  if (compareOldContent === compareNewContentt)
    tools.exit.success("Same result");

  startIndex++;

  // 把 <!-- UPDATE_WEISITE:START --> 到 <!-- UPDATE_WEISITE:END --> 間的內容刪掉
  // 取得 START ~ END 的間隙
  let gap = endIndex - startIndex;
  readmeContent.splice(startIndex, gap);

  //重新把內容加進去
  outline.forEach((o, index) => {
    readmeContent.splice(
      startIndex + index,
      0,
      `- ${o.title} [連結](${o.link})`
    );
  });
  tools.log.success("Updated README with the recent blog outline");

  fs.writeFileSync("./README.md", readmeContent.join("\n"));

  try {
    await commitReadmeFile();
    tools.log.success("Commit file success");
  } catch (err) {
    tools.log.debug("Something went wrong");
    return tools.exit.failure(err);
  }
  tools.exit.success("Success");
});