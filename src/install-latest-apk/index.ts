import axios from "axios";
import fs from "fs";
import https from "https";
import path from "path";
import ProgressBar from "progress";

const JOB_URL = process.env.INSTALL_LATEST_APK_JOB_URL;
const LOCAL_STORAGE_PATH = process.env.INSTALL_LATEST_APK_STORAGE_PATH;
if (!JOB_URL || !LOCAL_STORAGE_PATH) {
    console.error("Please set environment variables INSTALL_LATEST_APK_JOB_URL and INSTALL_LATEST_APK_STORAGE_PATH");
    process.exit(1);
}

const ARTIFACTS_FETCH_URL = JOB_URL + "lastSuccessfulBuild/api/json?tree=artifacts[*]";
const ARTIFACT_DOWNLOAD_URL = JOB_URL + "lastSuccessfulBuild/artifact/";

interface Artifact {
    fileName: string;
    relativePath: string;
}

new Promise<string>((resolve, reject) => {
    https.get(ARTIFACTS_FETCH_URL, (result) => {
        result.on("data", (rawData) => {
            let filename;
            JSON.parse(rawData.toString()).artifacts.forEach((artifact: Artifact) => {
                if (artifact.fileName.endsWith(".apk")) filename = artifact.relativePath;
            });
            if (filename) resolve(filename);
            else reject("No apk file found");
        });
    });
})
    .then(async (fileName) => {
        console.log("Connecting …");
        const { data, headers } = await axios({
            url: ARTIFACT_DOWNLOAD_URL + fileName,
            method: "GET",
            responseType: "stream",
        });
        const totalLength = headers["content-length"];

        if (fs.existsSync(LOCAL_STORAGE_PATH) === false) fs.mkdirSync(LOCAL_STORAGE_PATH);
        const filePath = path.resolve(LOCAL_STORAGE_PATH, fileName);
        if (fs.existsSync(filePath)) {
            // 判断文件大小是否一致
            const stats = fs.statSync(filePath);
            if (stats.size === parseInt(totalLength)) {
                console.log("File already downloaded");
                return filePath;
            } else {
                console.log("File already downloaded, but file size is not match, redownload it");
                fs.unlinkSync(filePath);
            }
        }

        console.log("Starting download");
        const writer = fs.createWriteStream(filePath);
        const progressBar = new ProgressBar("-> downloading [:bar] :percent :etas", {
            width: 40,
            complete: "=",
            incomplete: " ",
            renderThrottle: 1,
            total: parseInt(totalLength),
        });
        data.on("data", (chunk: string | any[]) => progressBar.tick(chunk.length));
        data.pipe(writer);

        return new Promise<string>((resolve, reject) => {
            writer.on("finish", () => resolve(filePath));
            writer.on("error", () => reject("Download file failed"));
        });
    })
    .then((filePath) => {
        const installCmd = `adb install -r ${filePath}`;
        console.log(installCmd);
        return new Promise<void>((resolve, reject) => {
            const installProcess = require("child_process").exec(installCmd);
            installProcess.stdout.on("data", (data: any) => console.log(data));
            installProcess.stderr.on("data", (data: any) => console.error(data));
            installProcess.on("exit", (code: number) => {
                if (code === 0) resolve();
                else reject("install failed");
            });
        });
    })
    .finally(() => {
        console.log("install finished");
    })
    .catch((error) => {
        console.error("install failed,", error);
    });
