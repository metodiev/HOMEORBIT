import { get, run } from "@/lib/db";
import { nowIso } from "@/lib/util/ids";
import { ValidationError } from "@/lib/errors";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type TmdbSearchItem = {
  id: number;
  title: string;
  originalTitle: string;
  releaseDate: string | null;
  year: number | null;
  overview: string;
  posterUrl: string | null;
  voteAverage: number | null;
  originalLanguage: string | null;
  genreIds: number[];
};

export type MovieAvailability = {
  region: string;
  verified: boolean;
  link: string | null;
  flatrate: string[];
  rent: string[];
  buy: string[];
  attribution: string;
  note: string;
};

export type TmdbMovie = TmdbSearchItem & {
  runtimeMinutes: number | null;
  genres: { id: number; name: string }[];
  homepage: string | null;
  tagline: string | null;
  availability: MovieAvailability;
};

type TmdbRawMovie = {
  id?: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
  vote_average?: number;
  original_language?: string;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  runtime?: number | null;
  homepage?: string | null;
  tagline?: string | null;
};

type TmdbProviderRegion = {
  link?: string;
  flatrate?: { provider_name?: string }[];
  rent?: { provider_name?: string }[];
  buy?: { provider_name?: string }[];
};

export function tmdbConfigured(): boolean {
  return Boolean(process.env.TMDB_READ_TOKEN?.trim() || process.env.TMDB_API_KEY?.trim());
}

export function tmdbRegion(): string {
  return (process.env.TMDB_REGION?.trim() || "BG").toUpperCase().slice(0, 2);
}

function tmdbLanguage(): string {
  return process.env.TMDB_LANGUAGE?.trim() || "en-US";
}

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = process.env.TMDB_READ_TOKEN?.trim();
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (!token && !apiKey) {
    throw new ValidationError(
      "Movie data is not configured. Set TMDB_READ_TOKEN (or TMDB_API_KEY) on the server. HomeOrbit never invents titles or streaming availability.",
    );
  }
  const url = new URL(`${TMDB_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (!token && apiKey) url.searchParams.set("api_key", apiKey);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401) throw new ValidationError("TMDB rejected the configured credential.");
  if (response.status === 429) throw new ValidationError("TMDB rate limit reached. Try again shortly.");
  if (!response.ok) throw new ValidationError(`TMDB returned HTTP ${response.status}.`);
  return (await response.json()) as T;
}

function mapSearchItem(raw: TmdbRawMovie): TmdbSearchItem | null {
  if (!raw.id || !raw.title) return null;
  const releaseDate = raw.release_date?.trim() || null;
  return {
    id: raw.id,
    title: raw.title,
    originalTitle: raw.original_title ?? raw.title,
    releaseDate,
    year: releaseDate ? Number(releaseDate.slice(0, 4)) || null : null,
    overview: raw.overview ?? "",
    posterUrl: raw.poster_path ? `${IMAGE_BASE}${raw.poster_path}` : null,
    voteAverage: typeof raw.vote_average === "number" ? Math.round(raw.vote_average * 10) / 10 : null,
    originalLanguage: raw.original_language ?? null,
    genreIds: raw.genre_ids ?? [],
  };
}

export async function searchMovies(query: string, limit = 10): Promise<TmdbSearchItem[]> {
  const trimmed = query.trim();
  if (!trimmed) throw new ValidationError("Enter a movie title to search for.");
  if (trimmed.length > 200) throw new ValidationError("Movie searches are limited to 200 characters.");
  const payload = await tmdbFetch<{ results?: TmdbRawMovie[] }>("/search/movie", {
    query: trimmed,
    include_adult: "false",
    language: tmdbLanguage(),
    page: "1",
  });
  return (payload.results ?? []).map(mapSearchItem).filter((item): item is TmdbSearchItem => Boolean(item)).slice(0, limit);
}

export async function discoverMovies(options: {
  genreIds?: number[];
  originalLanguage?: string | null;
  limit?: number;
}): Promise<TmdbSearchItem[]> {
  const params: Record<string, string> = {
    include_adult: "false",
    language: tmdbLanguage(),
    sort_by: "popularity.desc",
    "vote_count.gte": "50",
    page: "1",
  };
  if (options.genreIds?.length) params.with_genres = options.genreIds.slice(0, 3).join(",");
  if (options.originalLanguage) params.with_original_language = options.originalLanguage;
  const payload = await tmdbFetch<{ results?: TmdbRawMovie[] }>("/discover/movie", params);
  return (payload.results ?? []).map(mapSearchItem).filter((item): item is TmdbSearchItem => Boolean(item)).slice(0, options.limit ?? 20);
}

export async function movieGenres(): Promise<{ id: number; name: string }[]> {
  const payload = await tmdbFetch<{ genres?: { id: number; name: string }[] }>("/genre/movie/list", {
    language: tmdbLanguage(),
  });
  return payload.genres ?? [];
}

function baseMovie(raw: TmdbRawMovie): TmdbSearchItem {
  const mapped = mapSearchItem(raw);
  return (
    mapped ?? {
      id: raw.id ?? 0,
      title: raw.title ?? "Unknown title",
      originalTitle: raw.original_title ?? raw.title ?? "Unknown title",
      releaseDate: raw.release_date?.trim() || null,
      year: raw.release_date ? Number(raw.release_date.slice(0, 4)) || null : null,
      overview: raw.overview ?? "",
      posterUrl: raw.poster_path ? `${IMAGE_BASE}${raw.poster_path}` : null,
      voteAverage: null,
      originalLanguage: raw.original_language ?? null,
      genreIds: [],
    }
  );
}

export async function movieDetails(tmdbId: number): Promise<TmdbMovie> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) throw new ValidationError("Invalid TMDB movie id.");
  const cached = get<{ payload_json: string; fetched_at: string }>("SELECT payload_json, fetched_at FROM movie_cache WHERE tmdb_id = ?", [
    tmdbId,
  ]);
  if (cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_TTL_MS) {
    return JSON.parse(cached.payload_json) as TmdbMovie;
  }
  const raw = await tmdbFetch<TmdbRawMovie>(`/movie/${tmdbId}`, { language: tmdbLanguage() });
  const region = tmdbRegion();
  let availability: MovieAvailability = {
    region,
    verified: false,
    link: null,
    flatrate: [],
    rent: [],
    buy: [],
    attribution: "Streaming availability data by JustWatch via TMDB.",
    note: `No verified provider data was returned for region ${region}. HomeOrbit does not guess streaming availability.`,
  };
  try {
    const providers = await tmdbFetch<{ results?: Record<string, TmdbProviderRegion> }>(
      `/movie/${tmdbId}/watch/providers`,
    );
    const entry = providers.results?.[region];
    if (entry) {
      const names = (items?: { provider_name?: string }[]) =>
        (items ?? []).map((item) => item.provider_name).filter((name): name is string => Boolean(name));
      const flatrate = names(entry.flatrate);
      const rent = names(entry.rent);
      const buy = names(entry.buy);
      availability = {
        ...availability,
        verified: Boolean(entry.link || flatrate.length || rent.length || buy.length),
        link: entry.link ?? null,
        flatrate,
        rent,
        buy,
        note: `Provider data for ${region} from JustWatch via TMDB. Availability can change; open the provider link to confirm.`,
      };
    }
  } catch {
    // Details still work without provider data; availability stays explicitly unverified.
  }
  const movie: TmdbMovie = {
    ...baseMovie(raw),
    genres: raw.genres ?? [],
    runtimeMinutes: typeof raw.runtime === "number" ? raw.runtime : null,
    homepage: raw.homepage ?? null,
    tagline: raw.tagline ?? null,
    availability,
  };
  run(
    `INSERT INTO movie_cache (tmdb_id, payload_json, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(tmdb_id) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`,
    [tmdbId, JSON.stringify(movie), nowIso()],
  );
  return movie;
}
