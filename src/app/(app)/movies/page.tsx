import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { t } from "@/lib/i18n";
import { toErrorMessage } from "@/lib/errors";
import {
  familyMovieNight,
  listMovieEntries,
  movieDetailFor,
  moviePreferences,
  recommendForMember,
  searchMovieCatalog,
  updateMovieEntry,
} from "@/lib/domain/movies";
import { movieGenres, tmdbConfigured, tmdbRegion, type MovieAvailability } from "@/lib/movies/tmdb";
import {
  addMovieAction,
  deleteMovieAction,
  updateMovieAction,
  updateMoviePreferencesAction,
} from "@/lib/actions";
import { Badge, Card, EmptyState, FeedbackBanner, PageHeader } from "@/components/ui";

export const metadata = { title: "Movie night" };

type Recommendation = {
  id: number;
  title: string;
  year: number | null;
  overview: string;
  posterUrl: string | null;
  voteAverage: number | null;
  availabilityNote: string;
};

export default async function MoviesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tmdb?: string; recommend?: string; ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const configured = tmdbConfigured();
  const entries = listMovieEntries(actor);
  const prefs = moviePreferences(actor);
  let genres: { id: number; name: string }[] = [];
  if (configured) {
    try {
      genres = await movieGenres();
    } catch {
      genres = [];
    }
  }
  const genreName = (id: number) => genres.find((genre) => genre.id === id)?.name ?? String(id);

  let search: { results: Awaited<ReturnType<typeof searchMovieCatalog>>["results"]; note: string } | null = null;
  let detail: Awaited<ReturnType<typeof movieDetailFor>> | null = null;
  let recommendations: Recommendation[] | null = null;
  let recommendationNote = "";
  let pageError = params.error ?? null;
  if (params.q?.trim()) {
    try {
      const result = await searchMovieCatalog(params.q.trim());
      search = { results: result.results, note: result.note };
    } catch (error) {
      pageError = toErrorMessage(error);
    }
  }
  if (params.tmdb && configured) {
    try {
      detail = await movieDetailFor(Number(params.tmdb));
    } catch (error) {
      pageError = toErrorMessage(error);
    }
  }
  if (params.recommend === "personal" || params.recommend === "family") {
    try {
      if (params.recommend === "family") {
        const result = await familyMovieNight(actor, 10);
        recommendations = result.recommendations;
        recommendationNote = result.note;
      } else {
        const result = await recommendForMember(actor, 10);
        recommendations = result.recommendations;
        recommendationNote = result.note;
      }
    } catch (error) {
      pageError = toErrorMessage(error);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={configured ? "TMDB · external service" : "TMDB not configured"}
        title={t(actor.locale, "movies.title")}
        subtitle={t(actor.locale, "movies.subtitle")}
      />
      <FeedbackBanner ok={params.ok} error={pageError ?? undefined} />

      {!configured ? (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>No real movie data source is configured.</strong> Set <code>TMDB_READ_TOKEN</code> (or{" "}
          <code>TMDB_API_KEY</code>) and optionally <code>TMDB_REGION</code> on the server. HomeOrbit will not invent titles,
          release dates or streaming availability.
        </div>
      ) : (
        <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <Badge tone="amber">☁ TMDB external service</Badge>
          <span>
            Region <strong>{tmdbRegion()}</strong>. Streaming data comes from JustWatch via TMDB and is marked verified only
            when provider data exists.
          </span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card title="Search real movies" subtitle="Search results come directly from TMDB; nothing is generated locally.">
            <form method="get" action="/movies" className="flex gap-2">
              <input name="q" defaultValue={params.q ?? ""} placeholder="Movie title…" className="field mt-0 flex-1" />
              <button type="submit" className="btn-secondary" disabled={!configured}>
                Search
              </button>
            </form>
            {search ? (
              <div className="mt-4 space-y-3">
                <p className="text-[11px] text-ink-soft">{search.note}</p>
                {search.results.length === 0 ? <p className="text-sm text-ink-soft">No TMDB results.</p> : null}
                {search.results.map((movie) => (
                  <article key={movie.id} className="flex gap-3 rounded-2xl border border-black/5 p-3">
                    {movie.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={movie.posterUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-24 w-16 rounded-lg object-cover" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">
                        {movie.title} {movie.year ? `(${movie.year})` : ""}
                      </p>
                      <p className="text-[11px] text-ink-soft">
                        {movie.originalLanguage?.toUpperCase()} · ⭐ {movie.voteAverage ?? "—"} · TMDB {movie.id}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-ink-soft">{movie.overview}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <form action={addMovieAction}>
                          <input type="hidden" name="tmdbId" value={movie.id} />
                          <input type="hidden" name="status" value="watchlist" />
                          <button type="submit" className="btn-secondary px-2 py-1 text-[11px]">
                            + Watchlist
                          </button>
                        </form>
                        <Link href={`/movies?tmdb=${movie.id}`} className="btn-ghost px-2 py-1 text-[11px]">
                          Details & availability
                        </Link>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </Card>

          {detail ? (
            <Card title={detail.title} subtitle={`TMDB ${detail.id} · ${detail.releaseDate ?? "release date unknown"}`}>
              <div className="flex flex-col gap-4 sm:flex-row">
                {detail.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={detail.posterUrl} alt="" referrerPolicy="no-referrer" className="h-56 w-40 rounded-xl object-cover" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{detail.overview}</p>
                  <p className="mt-2 text-xs text-ink-soft">
                    {detail.genres.map((genre) => genre.name).join(" · ")} · {detail.runtimeMinutes ?? "?"} min ·{" "}
                    {detail.originalLanguage?.toUpperCase()} · ⭐ {detail.voteAverage ?? "—"}
                  </p>
                  <Availability availability={detail.availability} />
                  <form action={addMovieAction} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="tmdbId" value={detail.id} />
                    <select name="status" className="field mt-0 w-auto py-1 text-xs" defaultValue="watchlist">
                      <option value="watchlist">Watchlist</option>
                      <option value="watched">Already watched</option>
                    </select>
                    <label className="flex items-center gap-1 text-[11px]">
                      <input type="checkbox" name="favorite" /> Favourite
                    </label>
                    <button type="submit" className="btn-secondary px-2 py-1 text-[11px]">
                      Save to my list
                    </button>
                  </form>
                </div>
              </div>
            </Card>
          ) : null}

          <Card title="Movie night recommendations" subtitle="Uses your preferences or an explicit family mode. Availability is verified per movie detail.">
            <div className="flex flex-wrap gap-2">
              <Link href="/movies?recommend=personal" className={`btn-secondary px-3 py-1.5 text-xs ${!configured ? "pointer-events-none opacity-50" : ""}`}>
                Recommend for me
              </Link>
              {actor.role !== "relative" ? (
                <Link href="/movies?recommend=family" className={`btn-secondary px-3 py-1.5 text-xs ${!configured ? "pointer-events-none opacity-50" : ""}`}>
                  Family movie night
                </Link>
              ) : null}
            </div>
            {recommendationNote ? <p className="mt-3 text-[11px] text-ink-soft">{recommendationNote}</p> : null}
            {recommendations ? (
              recommendations.length === 0 ? (
                <p className="mt-3 text-sm text-ink-soft">No recommendations were returned.</p>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {recommendations.map((movie) => (
                    <article key={movie.id} className="flex gap-2 rounded-2xl border border-black/5 p-2">
                      {movie.posterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={movie.posterUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-24 w-16 rounded-lg object-cover" />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink">
                          {movie.title} {movie.year ? `(${movie.year})` : ""}
                        </p>
                        <p className="line-clamp-2 text-[11px] text-ink-soft">{movie.overview}</p>
                        <p className="mt-1 text-[10px] text-ink-soft">{movie.availabilityNote}</p>
                        <div className="mt-1 flex gap-2">
                          <Link href={`/movies?tmdb=${movie.id}`} className="text-[11px] text-teal hover:underline">
                            Check availability
                          </Link>
                          <form action={addMovieAction}>
                            <input type="hidden" name="tmdbId" value={movie.id} />
                            <button type="submit" className="text-[11px] text-teal hover:underline">
                              + Watchlist
                            </button>
                          </form>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )
            ) : null}
          </Card>

          <Card title="My lists" subtitle="Private watchlists, ratings and notes — isolated from every other member.">
            {entries.length === 0 ? (
              <EmptyState icon="🎬" title="Your movie list is empty" description="Search for a real TMDB title and add it." />
            ) : (
              <div className="space-y-3">
                {entries.map((entry) => (
                  <article key={entry.id} className="rounded-2xl border border-black/5 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-ink">
                          {entry.title} {entry.year ? `(${entry.year})` : ""}
                        </p>
                        <p className="text-[11px] text-ink-soft">
                          {entry.status} · {entry.genres.join(", ") || "genres unknown"} · {entry.language?.toUpperCase() ?? "—"}
                          {entry.favorite === 1 ? " · ★ favourite" : ""}
                          {entry.rating ? ` · ${entry.rating}/10` : ""}
                        </p>
                        {entry.notes ? <p className="mt-1 text-xs text-ink-soft">{entry.notes}</p> : null}
                      </div>
                      <form action={deleteMovieAction}>
                        <input type="hidden" name="entryId" value={entry.id} />
                        <button type="submit" className="text-[11px] text-red-700 hover:underline">
                          Remove
                        </button>
                      </form>
                    </div>
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-ink-soft hover:text-teal">Update</summary>
                      <form action={updateMovieAction} className="mt-2 grid gap-2 sm:grid-cols-2">
                        <input type="hidden" name="entryId" value={entry.id} />
                        <input type="hidden" name="favoriteForm" value="1" />
                        <select name="status" defaultValue={entry.status} className="field mt-0 py-1">
                          <option value="watchlist">Watchlist</option>
                          <option value="watched">Watched</option>
                        </select>
                        <input name="rating" type="number" min={1} max={10} defaultValue={entry.rating ?? ""} placeholder="Rating 1-10" className="field mt-0 py-1" />
                        <label className="flex items-center gap-1 text-[11px]">
                          <input type="checkbox" name="favorite" defaultChecked={entry.favorite === 1} /> Favourite
                        </label>
                        <input name="notes" defaultValue={entry.notes ?? ""} placeholder="Private notes" className="field mt-0 py-1" />
                        <button type="submit" className="btn-secondary py-1 text-[11px] sm:col-span-2">
                          Save
                        </button>
                      </form>
                    </details>
                  </article>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="My movie preferences" subtitle="Used only for your personal recommendations.">
            <form action={updateMoviePreferencesAction} className="space-y-3">
              <input type="hidden" name="redirectTo" value="/movies" />
              <div>
                <p className="label">Preferred genres</p>
                <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-black/5 p-2 text-[11px]">
                  {genres.length === 0 ? <p className="text-ink-soft">Configure TMDB to load genres.</p> : null}
                  {genres.map((genre) => (
                    <label key={genre.id} className="flex items-center gap-1">
                      <input type="checkbox" name="genreIds" value={genre.id} defaultChecked={prefs.genres.includes(genre.id)} />{" "}
                      {genre.name}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="label">Avoid genres</p>
                <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-black/5 p-2 text-[11px]">
                  {genres.map((genre) => (
                    <label key={genre.id} className="flex items-center gap-1">
                      <input type="checkbox" name="avoidGenreIds" value={genre.id} defaultChecked={prefs.avoidGenres.includes(genre.id)} />{" "}
                      {genre.name}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="languages">
                  Preferred languages (ISO codes, comma separated)
                </label>
                <input id="languages" name="languages" defaultValue={prefs.languages.join(", ")} className="field" placeholder="bg, en" />
              </div>
              <div>
                <label className="label" htmlFor="favoriteServices">
                  Services you use
                </label>
                <input id="favoriteServices" name="favoriteServices" defaultValue={prefs.favoriteServices.join(", ")} className="field" placeholder="Netflix, HBO Max" />
              </div>
              <p className="text-[11px] text-ink-soft">
                Current genre ids: {prefs.genres.map(genreName).join(", ") || "none"}. Genre names come from TMDB.
              </p>
              <button type="submit" className="btn w-full" disabled={!configured}>
                Save preferences
              </button>
            </form>
          </Card>

          <Card title="Honest availability">
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>✅ “Verified” means TMDB returned JustWatch provider data for {tmdbRegion()}.</li>
              <li>❔ Recommendations show general movie info only until you open details.</li>
              <li>🚫 HomeOrbit never guesses a streaming service, release date or title.</li>
              <li>🔐 Watchlists and ratings are private to each member. Family mode only aggregates genres and hides watched titles.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function Availability({ availability }: { availability: MovieAvailability }) {
  return (
    <div className="mt-3 rounded-xl bg-sand/60 p-3 text-xs">
      <p className="font-semibold text-ink">
        {availability.verified ? "✅ Verified streaming availability" : "❔ Streaming availability not verified"}
      </p>
      <p className="mt-1 text-ink-soft">{availability.note}</p>
      {availability.verified ? (
        <div className="mt-2 space-y-1 text-[11px]">
          <p>Streaming: {availability.flatrate.join(", ") || "none listed"}</p>
          <p>Rent: {availability.rent.join(", ") || "none listed"}</p>
          <p>Buy: {availability.buy.join(", ") || "none listed"}</p>
          {availability.link ? (
            <a href={availability.link} target="_blank" rel="noreferrer" className="text-teal hover:underline">
              Open JustWatch provider page →
            </a>
          ) : null}
          <p className="text-ink-soft">{availability.attribution}</p>
        </div>
      ) : null}
    </div>
  );
}
