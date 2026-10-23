import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupDb, createFixture, freshDb, type Fixture } from "./helpers";
import { all, get, run } from "@/lib/db";
import { AppError, ValidationError } from "@/lib/errors";
import { createMemory, listMemories, updateAiProfile, updateMemory } from "@/lib/domain/ai-profile";
import {
  addAssetToAlbum,
  canViewAlbum,
  createAlbum,
  createUploadedAsset,
  getAsset,
  getAssetForDownload,
  listAssets,
  shareAsset,
} from "@/lib/domain/media";
import { searchPhotos } from "@/lib/domain/photos";
import { deleteStoredFile, detectImage, resolveStoredPath } from "@/lib/media/storage";
import { createWorkflow, installSampleWorkflow, listWorkflows } from "@/lib/domain/image-workflows";
import { listImageJobs, processImageQueue } from "@/lib/images/queue";
import { executeApprovedTool, executeTool, toolSpecsForMessage } from "@/lib/agent/tools";
import { runAgent } from "@/lib/agent/runner";
import { decideApproval } from "@/lib/domain/approvals";
import {
  addMovieEntry,
  familyMovieNight,
  listMovieEntries,
  movieDetailFor,
  moviePreferences,
  recommendForMember,
  searchMovieCatalog,
  updateMovieEntry,
  updateMoviePreferences,
} from "@/lib/domain/movies";
import { webSearch, fetchWebPage, htmlToText } from "@/lib/ai/web";
import { addDaysToDateString, dateStringInZone } from "@/lib/util/dates";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function clearPlatformEnv(): void {
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_MODEL;
  delete process.env.OLLAMA_VISION_MODEL;
  delete process.env.OLLAMA_EMBED_MODEL;
  delete process.env.COMFYUI_URL;
  delete process.env.COMFYUI_CHECKPOINT;
  delete process.env.TMDB_API_KEY;
  delete process.env.TMDB_READ_TOKEN;
  delete process.env.TMDB_REGION;
  delete process.env.SEARXNG_URL;
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
}

describe("private family AI platform", () => {
  let dbFile: string;
  let f: Fixture;
  const storedPaths: string[] = [];

  beforeAll(() => {
    dbFile = freshDb();
    f = createFixture();
    updateAiProfile(f.adminActor, { shareFamilyKnowledge: true });
    updateAiProfile(f.adultActor, { shareFamilyKnowledge: true });
  });

  afterAll(async () => {
    for (const storagePath of storedPaths) await deleteStoredFile(storagePath);
    cleanupDb(dbFile);
  });

  beforeEach(() => {
    clearPlatformEnv();
    vi.unstubAllGlobals();
  });

  it("isolates private memories while sharing consented family knowledge", () => {
    const privateMemory = createMemory(f.adminActor, {
      content: "Ivan privately prefers films with English subtitles.",
      scope: "private",
      category: "movies",
      tags: ["subtitles"],
    });
    const familyMemory = createMemory(f.adminActor, {
      content: "The family eats dinner together at 19:00.",
      scope: "family",
      category: "routine",
    });
    const adultFamily = createMemory(f.adultActor, {
      content: "We prefer Friday for family movie night.",
      scope: "family",
      category: "movies",
    });

    const adultVisible = listMemories(f.adultActor, { scope: "all" });
    expect(adultVisible.some((memory) => memory.id === privateMemory.id)).toBe(false);
    expect(adultVisible.some((memory) => memory.id === familyMemory.id)).toBe(true);
    expect(adultVisible.some((memory) => memory.id === adultFamily.id)).toBe(true);

    expect(() => updateMemory(f.adultActor, privateMemory.id, { content: "stolen" })).toThrow(AppError);
    expect(() => updateMemory(f.adultActor, familyMemory.id, { content: "stolen" })).toThrow(AppError);

    const guestVisible = listMemories(f.relativeActor, { scope: "all" });
    expect(guestVisible).toHaveLength(0);
    expect(() =>
      createMemory(f.relativeActor, { content: "Guest family fact", scope: "family" }),
    ).toThrow(AppError);

    updateAiProfile(f.adminActor, { shareFamilyKnowledge: false });
    const afterRevoke = listMemories(f.adultActor, { scope: "all" });
    expect(afterRevoke.some((memory) => memory.id === familyMemory.id)).toBe(false);
    const ownAfterRevoke = listMemories(f.adminActor, { scope: "private" });
    expect(ownAfterRevoke.some((memory) => memory.id === familyMemory.id)).toBe(true);
    updateAiProfile(f.adminActor, { shareFamilyKnowledge: true });
  });

  it("enforces image ownership, direct sharing, albums and guest restrictions", async () => {
    const upload = await createUploadedAsset(f.adminActor, {
      buffer: PNG,
      filename: "secret.png",
      library: "studio",
      caption: "Private sketch",
      tags: ["sketch"],
    });
    const row = getAssetForDownload(f.adminActor, upload.id);
    storedPaths.push(row.storage_path);

    expect(getAsset(f.adminActor, upload.id).id).toBe(upload.id);
    expect(listAssets(f.adultActor, { library: "studio" }).some((asset) => asset.id === upload.id)).toBe(false);
    expect(() => getAsset(f.adultActor, upload.id)).toThrow(AppError);
    expect(() => getAsset(f.relativeActor, upload.id)).toThrow(AppError);
    expect(listAssets(f.relativeActor, { library: "studio" })).toHaveLength(0);

    shareAsset(f.adminActor, upload.id, [f.adult.id]);
    expect(getAsset(f.adultActor, upload.id).id).toBe(upload.id);
    expect(listAssets(f.adultActor, { library: "studio" }).some((asset) => asset.id === upload.id)).toBe(true);
    expect(() => getAsset(f.relativeActor, upload.id)).toThrow(AppError);

    const album = createAlbum(f.adminActor, { name: "Family sketches", visibility: "family" });
    addAssetToAlbum(f.adminActor, album.id, upload.id);
    expect(canViewAlbum(f.adultActor, album)).toBe(true);
    expect(canViewAlbum(f.relativeActor, album)).toBe(false);
    expect(() => getAsset(f.relativeActor, upload.id)).toThrow(AppError);
  });

  it("rejects non-images and blocks path traversal", async () => {
    await expect(
      createUploadedAsset(f.adminActor, {
        buffer: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"),
        filename: "attack.svg",
        library: "photos",
      }),
    ).rejects.toThrow(AppError);
    expect(detectImage(PNG)?.mime).toBe("image/png");
    expect(() => resolveStoredPath("../../outside.txt")).toThrow();
  });

  it("filters photo searches by visibility", async () => {
    const photo = await createUploadedAsset(f.adminActor, {
      buffer: PNG,
      filename: "beach.png",
      library: "photos",
      caption: "Beach at sunset",
      tags: ["beach", "sunset"],
    });
    storedPaths.push(getAssetForDownload(f.adminActor, photo.id).storage_path);

    const adultBefore = await searchPhotos(f.adultActor, { query: "beach" });
    expect(adultBefore.assets.some((asset) => asset.id === photo.id)).toBe(false);
    const relativeBefore = await searchPhotos(f.relativeActor, { query: "sunset" });
    expect(relativeBefore.assets).toHaveLength(0);

    shareAsset(f.adminActor, photo.id, [f.adult.id]);
    const adultAfter = await searchPhotos(f.adultActor, { query: "beach" });
    expect(adultAfter.assets.some((asset) => asset.id === photo.id)).toBe(true);
    expect(adultAfter.mode).toBe("text");
    const relativeAfter = await searchPhotos(f.relativeActor, { query: "beach" });
    expect(relativeAfter.assets).toHaveLength(0);
  });

  it("serializes image jobs and keeps queues private per member", async () => {
    const workflow = createWorkflow(f.adminActor, {
      name: "Test workflow",
      operation: "text_to_image",
      workflowJson: JSON.stringify({ "1": { class_type: "TestNode", inputs: { prompt: "{{PROMPT}}" } } }),
      enabled: true,
    });
    expect(listWorkflows(f.adultActor, { operation: "text_to_image" }).some((entry) => entry.id === workflow.id)).toBe(true);

    run(
      `INSERT INTO image_jobs (id, household_id, member_id, provider, workflow_id, operation, prompt, status, progress, params_json, created_at)
       VALUES ('job-test-1', ?, ?, 'comfyui', ?, 'text_to_image', 'first', 'queued', 0, '{}', '2024-01-01T00:00:01.000Z')`,
      [f.householdId, f.admin.id, workflow.id],
    );
    run(
      `INSERT INTO image_jobs (id, household_id, member_id, provider, workflow_id, operation, prompt, status, progress, params_json, created_at)
       VALUES ('job-test-2', ?, ?, 'comfyui', ?, 'text_to_image', 'second', 'queued', 0, '{}', '2024-01-01T00:00:02.000Z')`,
      [f.householdId, f.admin.id, workflow.id],
    );

    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    await processImageQueue(async (job) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(job.id);
      const otherRunning = get<{ id: string }>(
        "SELECT id FROM image_jobs WHERE status = 'running' AND id != ?",
        [job.id],
      );
      expect(otherRunning).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 15));
      run("UPDATE image_jobs SET status = 'succeeded', progress = 100, finished_at = ? WHERE id = ?", [
        new Date().toISOString(),
        job.id,
      ]);
      active -= 1;
    });

    expect(order).toEqual(["job-test-1", "job-test-2"]);
    expect(maxActive).toBe(1);
    expect(listImageJobs(f.adminActor).filter((job) => job.id.startsWith("job-test-"))).toHaveLength(2);
    expect(listImageJobs(f.adultActor).some((job) => job.id.startsWith("job-test-"))).toBe(false);
  });

  it("runs a real ComfyUI job end-to-end against a stub server and stores a private result", async () => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/prompt") {
        request.resume();
        request.on("end", () => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ prompt_id: "stub-prompt-1" }));
        });
        return;
      }
      if (url.pathname === "/history/stub-prompt-1") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            "stub-prompt-1": {
              outputs: { "9": { images: [{ filename: "result.png", subfolder: "", type: "output" }] } },
            },
          }),
        );
        return;
      }
      if (url.pathname === "/view") {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(PNG);
        return;
      }
      if (url.pathname === "/queue") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Stub server did not start.");
    process.env.COMFYUI_URL = `http://127.0.0.1:${address.port}`;
    process.env.COMFYUI_TIMEOUT_SECONDS = "10";

    try {
      const workflow = createWorkflow(f.adminActor, {
        name: "Stub text workflow",
        operation: "text_to_image",
        workflowJson: JSON.stringify({
          "1": { class_type: "CLIPTextEncode", inputs: { text: "{{PROMPT}}" } },
          "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "stub" } },
        }),
        enabled: true,
      });
      const job = (await import("@/lib/images/queue")).enqueueImageJob(f.adminActor, {
        operation: "text_to_image",
        prompt: "stub generation",
        workflowId: workflow.id,
      });

      let final = get<{ status: string; error: string | null; result_asset_id: string | null }>(
        "SELECT status, error, result_asset_id FROM image_jobs WHERE id = ?",
        [job.id],
      );
      for (let attempt = 0; attempt < 100 && final?.status !== "succeeded" && final?.status !== "failed"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        final = get("SELECT status, error, result_asset_id FROM image_jobs WHERE id = ?", [job.id]);
      }
      expect(final?.status).toBe("succeeded");
      expect(final?.result_asset_id).toBeTruthy();
      const result = getAsset(f.adminActor, final!.result_asset_id!);
      expect(result.owner_member_id).toBe(f.admin.id);
      expect(result.kind).toBe("generated");
      storedPaths.push(getAssetForDownload(f.adminActor, result.id).storage_path);
      expect(() => getAsset(f.adultActor, result.id)).toThrow(AppError);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("validates workflow JSON and restricts workflow management to administrators", () => {
    expect(() =>
      createWorkflow(f.adultActor, {
        name: "Not allowed",
        operation: "text_to_image",
        workflowJson: "{}",
      }),
    ).toThrow(AppError);
    expect(() =>
      createWorkflow(f.adminActor, {
        name: "UI workflow",
        operation: "text_to_image",
        workflowJson: JSON.stringify({ nodes: [], links: [] }),
      }),
    ).toThrow(/UI workflow/);
    const sample = installSampleWorkflow(f.adminActor, "sample-text2img");
    expect(sample.enabled).toBe(0);
    expect(sample.workflow_json).toContain("{{PROMPT}}");
  });

  it("executes approved sharing as the requester, never as the approving guardian", async () => {
    const photo = await createUploadedAsset(f.adultActor, {
      buffer: PNG,
      filename: "adult-private.png",
      library: "studio",
      caption: "Adult private image",
    });
    storedPaths.push(getAssetForDownload(f.adultActor, photo.id).storage_path);
    expect(() => getAsset(f.adminActor, photo.id)).toThrow(AppError);

    const outcome = await executeTool(f.adultActor, "share_image", {
      imageId: photo.id,
      memberNames: [f.admin.name],
    });
    expect(outcome.requiresApproval).toBe(true);
    expect(outcome.approvalId).toBeTruthy();
    decideApproval(f.adminActor, outcome.approvalId!, "approved");
    const executed = await executeApprovedTool(f.adminActor, outcome.approvalId!);
    expect(executed.ok).toBe(true);
    expect(getAsset(f.adminActor, photo.id).id).toBe(photo.id);
  });

  it("never invents movie data when TMDB is not configured", async () => {
    const search = await searchMovieCatalog("a film that does not exist");
    expect(search.configured).toBe(false);
    expect(search.results).toHaveLength(0);
    const personal = await recommendForMember(f.adminActor);
    expect(personal.configured).toBe(false);
    expect(personal.recommendations).toHaveLength(0);
    const family = await familyMovieNight(f.adminActor);
    expect(family.configured).toBe(false);
    expect(family.recommendations).toHaveLength(0);
    expect(listMovieEntries(f.adminActor)).toHaveLength(0);
    await expect(addMovieEntry(f.adminActor, { tmdbId: 550 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("uses real TMDB data and labels verified streaming availability when configured", async () => {
    process.env.TMDB_API_KEY = "test-key";
    process.env.TMDB_REGION = "BG";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/search/movie")) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  id: 550,
                  title: "Fight Club",
                  original_title: "Fight Club",
                  release_date: "1999-10-15",
                  overview: "An insomniac office worker meets a soap salesman.",
                  poster_path: "/poster.jpg",
                  vote_average: 8.4,
                  original_language: "en",
                  genre_ids: [18],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/watch/providers")) {
          return new Response(
            JSON.stringify({
              results: {
                BG: {
                  link: "https://www.themoviedb.org/movie/550/watch?locale=BG",
                  flatrate: [{ provider_name: "Example Streaming" }],
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            id: 550,
            title: "Fight Club",
            original_title: "Fight Club",
            release_date: "1999-10-15",
            overview: "An insomniac office worker meets a soap salesman.",
            poster_path: "/poster.jpg",
            vote_average: 8.4,
            original_language: "en",
            genres: [{ id: 18, name: "Drama" }],
            runtime: 139,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const search = await searchMovieCatalog("Fight Club");
    expect(search.configured).toBe(true);
    expect(search.provider).toBe("TMDB");
    expect(search.results[0].title).toBe("Fight Club");

    const detail = await movieDetailFor(550);
    expect(detail.availability.verified).toBe(true);
    expect(detail.availability.region).toBe("BG");
    expect(detail.availability.flatrate).toContain("Example Streaming");

    const entry = await addMovieEntry(f.adminActor, { tmdbId: 550, status: "watched", rating: 9, favorite: true });
    expect(entry.title).toBe("Fight Club");
    expect(entry.genres).toContain("Drama");
    const updated = updateMovieEntry(f.adminActor, entry.id, { notes: "Great film" });
    expect(updated.notes).toBe("Great film");
    expect(listMovieEntries(f.adminActor)).toHaveLength(1);

    updateMoviePreferences(f.adminActor, { languages: ["bg", "en"], genres: [18] });
    expect(moviePreferences(f.adminActor).languages).toEqual(["bg", "en"]);
  });

  it("saves and retrieves memories through natural language, and degrades honestly", async () => {
    const saved = await runAgent(f.adminActor, {
      message: "Remember that I prefer Bulgarian films with English subtitles.",
    });
    expect(saved.toolRuns.some((run) => run.name === "save_memory" && run.status === "success")).toBe(true);
    const memory = get<{ scope: string; content: string }>(
      "SELECT scope, content FROM member_memories WHERE member_id = ? AND content LIKE '%Bulgarian films%'",
      [f.admin.id],
    );
    expect(memory?.scope).toBe("private");

    const recalled = await runAgent(f.adminActor, { message: "What do you remember?" });
    expect(recalled.reply).toContain("Bulgarian films");

    const noImage = await runAgent(f.adminActor, { message: "Draw a quiet reading corner" });
    expect(noImage.reply).toContain("ComfyUI is not configured");

    const noMovie = await runAgent(f.adminActor, { message: "Recommend a movie for me" });
    expect(noMovie.reply.toLowerCase()).toContain("tmdb is not configured");

    const noWeb = await runAgent(f.adminActor, { message: "Search the web for museum opening times" });
    expect(noWeb.reply.toLowerCase()).toContain("not configured");
  });

  it("sends small, focused tool sets to local models without hiding requested capabilities", () => {
    const agenda = toolSpecsForMessage("What is planned for tomorrow?").map((spec) => spec.name);
    expect(agenda).toContain("get_family_agenda");
    expect(agenda).not.toContain("generate_image");
    expect(agenda.length).toBeLessThan(30);

    const images = toolSpecsForMessage("Draw a picture and then edit the beach photo").map((spec) => spec.name);
    expect(images).toEqual(expect.arrayContaining(["generate_image", "edit_image", "share_image"]));

    const movies = toolSpecsForMessage("Recommend a film for family movie night").map((spec) => spec.name);
    expect(movies).toEqual(expect.arrayContaining(["recommend_movies", "search_movies"]));

    const web = toolSpecsForMessage("Search the web for https://example.com").map((spec) => spec.name);
    expect(web).toEqual(expect.arrayContaining(["web_search", "fetch_web_page"]));
  });

  it("does not repeat a side-effecting tool when the model fails after the tool result", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_BASE_URL = "http://provider.invalid/v1";
    process.env.AI_MODEL = "weak-model";
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-task",
                        type: "function",
                        function: {
                          name: "create_task",
                          arguments: JSON.stringify({ title: "Do not duplicate me", category: "chore" }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"type":"function","name":"create_task"}' } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const result = await runAgent(f.adminActor, { message: "Create a task called Do not duplicate me" });
    expect(result.reply).toContain("Created task");
    expect(result.reply).not.toContain('"type":"function"');
    expect(result.providerError).toMatch(/tool schema/i);
    expect(
      all("SELECT id FROM tasks WHERE household_id = ? AND title = 'Do not duplicate me'", [f.householdId]),
    ).toHaveLength(1);
  });

  it("falls back instead of showing malformed tool-schema text from a weak model", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_BASE_URL = "http://provider.invalid/v1";
    process.env.AI_MODEL = "weak-model";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"type":"function","name":"search_photos","parameters":{"type":"object","properties":{}}}',
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const result = await runAgent(f.adminActor, { message: "What do you remember?" });
    expect(result.mode).toBe("local");
    expect(result.providerError).toMatch(/tool schema/i);
    expect(result.reply).not.toContain('"parameters"');
    expect(result.reply).toContain("Bulgarian films");
  });

  it("repairs a small model's wrong year for an explicit relative date", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_BASE_URL = "http://provider.invalid/v1";
    process.env.AI_MODEL = "weak-model";
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-1",
                        type: "function",
                        function: {
                          name: "get_family_agenda",
                          arguments: JSON.stringify({ dateFrom: "2024-10-25", dateTo: "2024-10-25" }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "The agenda was checked." } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const result = await runAgent(f.adminActor, { message: "What is planned for tomorrow?" });
    expect(result.mode).toBe("llm");
    const execution = get<{ arguments_json: string }>(
      "SELECT arguments_json FROM tool_executions WHERE tool_name = 'get_family_agenda' ORDER BY created_at DESC LIMIT 1",
    );
    const args = JSON.parse(execution!.arguments_json) as { dateFrom: string; dateTo: string };
    const expected = addDaysToDateString(dateStringInZone(new Date(), "Europe/Sofia"), 1);
    expect(args.dateFrom).toBe(expected);
    expect(args.dateTo).toBe(expected);
  });

  it("keeps web tools off when unconfigured and blocks private addresses", async () => {
    const search = await webSearch("museum opening times");
    expect(search.configured).toBe(false);
    expect(search.results).toHaveLength(0);
    await expect(fetchWebPage("http://127.0.0.1:11434/api/tags")).rejects.toBeInstanceOf(ValidationError);
    await expect(fetchWebPage("http://localhost:8188")).rejects.toBeInstanceOf(ValidationError);
    await expect(fetchWebPage("file:///etc/passwd")).rejects.toBeInstanceOf(ValidationError);
    const text = htmlToText("<html><head><title>Hello</title><script>ignore()</script></head><body><p>One &amp; two</p></body></html>");
    expect(text.title).toBe("Hello");
    expect(text.text).toContain("One & two");
    expect(text.text).not.toContain("ignore()");
  });

  it("logs external tool usage separately from local tools", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "test-brave";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            web: { results: [{ title: "Example", url: "https://example.com/page", description: "A result" }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await executeTool(f.adminActor, "web_search", { query: "example" });
    const row = get<{ external_service: number }>(
      "SELECT external_service FROM tool_executions WHERE tool_name = 'web_search' ORDER BY created_at DESC LIMIT 1",
    );
    expect(row?.external_service).toBe(1);
  });

  it("keeps the media table and queues usable after the extension migration", () => {
    const tables = all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('member_memories','media_assets','image_jobs','movie_entries')",
    ).map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(["member_memories", "media_assets", "image_jobs", "movie_entries"]));
  });
});
