import { all, get, run } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import type { MemberRow, MovieEntryRow } from "@/lib/db/rows";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso, parseJson, toJson } from "@/lib/util/ids";
import { recordAudit } from "@/lib/domain/audit";
import {
  discoverMovies,
  movieDetails,
  movieGenres,
  searchMovies,
  tmdbConfigured,
  tmdbRegion,
  type TmdbMovie,
  type TmdbSearchItem,
} from "@/lib/movies/tmdb";

export type MoviePreferences = {
  genres: number[];
  avoidGenres: number[];
  languages: string[];
  favoriteServices: string[];
};

export type MovieRecommendation = TmdbSearchItem & {
  verifiedAvailability: false;
  availabilityNote: string;
};

const LANGUAGE_PATTERN = /^[a-z]{2}$/;

function memberFor(actor: Actor): MemberRow {
  const member = get<MemberRow>("SELECT * FROM members WHERE id = ? AND household_id = ?", [actor.id, actor.householdId]);
  if (!member || member.deactivated_at) throw new NotFoundError("Member not found.");
  return member;
}

export function moviePreferences(actor: Actor): MoviePreferences {
  const member = memberFor(actor);
  const stored = parseJson<Partial<MoviePreferences>>(member.movie_preferences_json, {});
  return {
    genres: (stored.genres ?? []).filter((id) => Number.isInteger(id) && id > 0).slice(0, 12),
    avoidGenres: (stored.avoidGenres ?? []).filter((id) => Number.isInteger(id) && id > 0).slice(0, 12),
    languages: (stored.languages ?? (actor.locale.startsWith("bg") ? ["bg", "en"] : ["en"]))
      .filter((code) => LANGUAGE_PATTERN.test(code))
      .slice(0, 6),
    favoriteServices: (stored.favoriteServices ?? []).map((name) => name.trim()).filter(Boolean).slice(0, 12),
  };
}

export function updateMoviePreferences(actor: Actor, input: Partial<MoviePreferences>): MoviePreferences {
  const current = moviePreferences(actor);
  const next: MoviePreferences = {
    genres: (input.genres ?? current.genres).filter((id) => Number.isInteger(id) && id > 0).slice(0, 12),
    avoidGenres: (input.avoidGenres ?? current.avoidGenres).filter((id) => Number.isInteger(id) && id > 0).slice(0, 12),
    languages: (input.languages ?? current.languages)
      .map((code) => code.toLowerCase())
      .filter((code) => LANGUAGE_PATTERN.test(code))
      .slice(0, 6),
    favoriteServices: (input.favoriteServices ?? current.favoriteServices)
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 12),
  };
  run("UPDATE members SET movie_preferences_json = ?, updated_at = ? WHERE id = ?", [
    toJson(next),
    nowIso(),
    actor.id,
  ]);
  recordAudit(actor, "movies.preferences_updated", "member", actor.id, next);
  return next;
}

export type MovieEntryView = MovieEntryRow & { genres: string[] };

function entryView(row: MovieEntryRow): MovieEntryView {
  return { ...row, genres: parseJson<string[]>(row.genres_json, []) };
}

export function listMovieEntries(
  actor: Actor,
  filter: { status?: "watchlist" | "watched"; favorite?: boolean } = {},
): MovieEntryView[] {
  const clauses = ["household_id = ?", "member_id = ?"];
  const values: (string | number)[] = [actor.householdId, actor.id];
  if (filter.status) {
    clauses.push("status = ?");
    values.push(filter.status);
  }
  if (filter.favorite) clauses.push("favorite = 1");
  return all<MovieEntryRow>(
    `SELECT * FROM movie_entries WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC`,
    values,
  ).map(entryView);
}

export async function addMovieEntry(
  actor: Actor,
  input: { tmdbId: number; status?: "watchlist" | "watched"; favorite?: boolean; rating?: number | null; notes?: string | null },
): Promise<MovieEntryView> {
  const details = await movieDetails(input.tmdbId);
  const rating = normalizeRating(input.rating);
  const existing = get<MovieEntryRow>("SELECT * FROM movie_entries WHERE member_id = ? AND tmdb_id = ?", [
    actor.id,
    details.id,
  ]);
  const timestamp = nowIso();
  if (existing) {
    run(
      `UPDATE movie_entries SET status = ?, favorite = ?, rating = ?, notes = ?, title = ?, year = ?, poster_url = ?,
       overview = ?, genres_json = ?, language = ?, updated_at = ? WHERE id = ?`,
      [
        input.status ?? existing.status,
        input.favorite === undefined ? existing.favorite : input.favorite ? 1 : 0,
        rating === undefined ? existing.rating : rating,
        input.notes === undefined ? existing.notes : input.notes?.trim().slice(0, 2000) || null,
        details.title,
        details.year,
        details.posterUrl,
        details.overview,
        toJson(details.genres.map((genre) => genre.name)),
        details.originalLanguage,
        timestamp,
        existing.id,
      ],
    );
    recordAudit(actor, "movies.entry_updated", "movie_entry", existing.id, { tmdbId: details.id });
    return entryView(get<MovieEntryRow>("SELECT * FROM movie_entries WHERE id = ?", [existing.id]) as MovieEntryRow);
  }
  const id = newId("movie");
  run(
    `INSERT INTO movie_entries (id, household_id, member_id, tmdb_id, title, year, poster_url, overview, genres_json,
      language, status, favorite, rating, notes, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tmdb', ?, ?)`,
    [
      id,
      actor.householdId,
      actor.id,
      details.id,
      details.title,
      details.year,
      details.posterUrl,
      details.overview,
      toJson(details.genres.map((genre) => genre.name)),
      details.originalLanguage,
      input.status ?? "watchlist",
      input.favorite ? 1 : 0,
      rating ?? null,
      input.notes?.trim().slice(0, 2000) || null,
      timestamp,
      timestamp,
    ],
  );
  recordAudit(actor, "movies.entry_added", "movie_entry", id, { tmdbId: details.id, title: details.title });
  return entryView(get<MovieEntryRow>("SELECT * FROM movie_entries WHERE id = ?", [id]) as MovieEntryRow);
}

function normalizeRating(value: number | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new ValidationError("Ratings must be whole numbers from 1 to 10.");
  }
  return value;
}

export function updateMovieEntry(
  actor: Actor,
  entryId: string,
  patch: { status?: "watchlist" | "watched"; favorite?: boolean; rating?: number | null; notes?: string | null },
): MovieEntryView {
  const entry = get<MovieEntryRow>("SELECT * FROM movie_entries WHERE id = ? AND household_id = ? AND member_id = ?", [
    entryId,
    actor.householdId,
    actor.id,
  ]);
  if (!entry) throw new NotFoundError("Movie entry not found.");
  const rating = normalizeRating(patch.rating);
  run(
    `UPDATE movie_entries SET status = ?, favorite = ?, rating = ?, notes = ?, updated_at = ? WHERE id = ?`,
    [
      patch.status ?? entry.status,
      patch.favorite === undefined ? entry.favorite : patch.favorite ? 1 : 0,
      rating === undefined ? entry.rating : rating,
      patch.notes === undefined ? entry.notes : patch.notes?.trim().slice(0, 2000) || null,
      nowIso(),
      entry.id,
    ],
  );
  recordAudit(actor, "movies.entry_updated", "movie_entry", entry.id);
  return entryView(get<MovieEntryRow>("SELECT * FROM movie_entries WHERE id = ?", [entry.id]) as MovieEntryRow);
}

export function deleteMovieEntry(actor: Actor, entryId: string): void {
  const entry = get<MovieEntryRow>("SELECT * FROM movie_entries WHERE id = ? AND household_id = ? AND member_id = ?", [
    entryId,
    actor.householdId,
    actor.id,
  ]);
  if (!entry) throw new NotFoundError("Movie entry not found.");
  run("DELETE FROM movie_entries WHERE id = ?", [entry.id]);
  recordAudit(actor, "movies.entry_deleted", "movie_entry", entry.id);
}

export type MovieSearchResponse = {
  configured: boolean;
  results: TmdbSearchItem[];
  provider: "TMDB";
  external: true;
  note: string;
};

export async function searchMovieCatalog(query: string): Promise<MovieSearchResponse> {
  if (!tmdbConfigured()) {
    return {
      configured: false,
      results: [],
      provider: "TMDB",
      external: true,
      note: "TMDB is not configured, so HomeOrbit has no real movie data source. No titles are invented.",
    };
  }
  const results = await searchMovies(query);
  return {
    configured: true,
    results,
    provider: "TMDB",
    external: true,
    note: "Results from TMDB (external service). Availability is verified only on the movie detail screen.",
  };
}

export async function movieDetailFor(tmdbId: number): Promise<TmdbMovie> {
  return movieDetails(tmdbId);
}

function seenTmdbIds(actor: Actor): Set<number> {
  return new Set(
    all<{ tmdb_id: number }>(
      "SELECT tmdb_id FROM movie_entries WHERE household_id = ? AND member_id = ? AND tmdb_id IS NOT NULL",
      [actor.householdId, actor.id],
    ).map((entry) => entry.tmdb_id),
  );
}

const GENERAL_AVAILABILITY_NOTE =
  "General movie information from TMDB. Streaming availability has not been verified for this recommendation; open the movie details to check JustWatch/TMDB provider data for your region.";

export async function recommendForMember(actor: Actor, limit = 10): Promise<{
  configured: boolean;
  recommendations: MovieRecommendation[];
  note: string;
}> {
  if (!tmdbConfigured()) {
    return {
      configured: false,
      recommendations: [],
      note: "TMDB is not configured, so HomeOrbit cannot recommend real titles. No movie data is invented.",
    };
  }
  const preferences = moviePreferences(actor);
  const genres = preferences.genres.filter((id) => !preferences.avoidGenres.includes(id));
  const seen = seenTmdbIds(actor);
  const languages = preferences.languages.length > 0 ? preferences.languages : [null];
  const collected: TmdbSearchItem[] = [];
  for (const language of languages.slice(0, 2)) {
    const results = await discoverMovies({ genreIds: genres, originalLanguage: language, limit: 20 });
    for (const item of results) {
      if (!seen.has(item.id) && !collected.some((entry) => entry.id === item.id)) collected.push(item);
    }
  }
  return {
    configured: true,
    recommendations: collected.slice(0, limit).map((item) => ({
      ...item,
      verifiedAvailability: false,
      availabilityNote: GENERAL_AVAILABILITY_NOTE,
    })),
    note: `Personal recommendations from TMDB for ${preferences.languages.join(", ") || "any language"}. Titles already in your watchlist are excluded.`,
  };
}

export async function familyMovieNight(actor: Actor, limit = 10): Promise<{
  configured: boolean;
  recommendations: MovieRecommendation[];
  participants: number;
  note: string;
}> {
  if (actor.role === "relative") throw new ForbiddenError("Family movie night is only available to household members.");
  if (!tmdbConfigured()) {
    return {
      configured: false,
      recommendations: [],
      participants: 0,
      note: "TMDB is not configured, so HomeOrbit cannot recommend real titles. No movie data is invented.",
    };
  }
  const members = all<{ id: string }>(
    "SELECT id FROM members WHERE household_id = ? AND role != 'relative' AND deactivated_at IS NULL",
    [actor.householdId],
  );
  const memberIds = members.map((member) => member.id);
  const placeholders = memberIds.map(() => "?").join(",");
  const entries = memberIds.length
    ? all<MovieEntryRow>(
        `SELECT * FROM movie_entries WHERE household_id = ? AND member_id IN (${placeholders})`,
        [actor.householdId, ...memberIds],
      )
    : [];
  const genreCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.favorite === 1 || (entry.rating ?? 0) >= 8) {
      for (const genre of parseJson<string[]>(entry.genres_json, [])) {
        genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
      }
    }
  }
  const topGenreNames = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  const watchedIds = new Set(
    entries.filter((entry) => entry.status === "watched" && entry.tmdb_id).map((entry) => entry.tmdb_id as number),
  );
  const familyLanguages = new Set<string>();
  for (const memberId of memberIds) {
    const member = get<MemberRow>("SELECT * FROM members WHERE id = ?", [memberId]);
    if (!member) continue;
    for (const language of moviePreferencesForMember(member).languages) familyLanguages.add(language);
  }
  let genreIds: number[] = [];
  if (topGenreNames.length > 0) {
    const catalog = await movieGenres();
    genreIds = topGenreNames
      .map((name) => catalog.find((genre) => genre.name.toLowerCase() === name.toLowerCase())?.id)
      .filter((id): id is number => Boolean(id));
  }
  const language = familyLanguages.size === 1 ? [...familyLanguages][0] : null;
  const results = await discoverMovies({ genreIds, originalLanguage: language, limit: 20 });
  const recommendations = results
    .filter((item) => !watchedIds.has(item.id))
    .slice(0, limit)
    .map((item) => ({
      ...item,
      verifiedAvailability: false as const,
      availabilityNote: GENERAL_AVAILABILITY_NOTE,
    }));
  return {
    configured: true,
    recommendations,
    participants: memberIds.length,
    note: `Family mode aggregates genres from ${memberIds.length} household members' favourites and high ratings, and hides titles anyone has already watched. Individual watchlists stay private. Region: ${tmdbRegion()}.`,
  };
}

function moviePreferencesForMember(member: MemberRow): MoviePreferences {
  const stored = parseJson<Partial<MoviePreferences>>(member.movie_preferences_json, {});
  return {
    genres: stored.genres ?? [],
    avoidGenres: stored.avoidGenres ?? [],
    languages: stored.languages ?? (member.locale.startsWith("bg") ? ["bg", "en"] : ["en"]),
    favoriteServices: stored.favoriteServices ?? [],
  };
}
