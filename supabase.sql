-- Wklej w Supabase: SQL Editor -> New query -> Run

create table public.quotes (
  id         bigint generated always as identity primary key,
  person     text    not null check (person in ('Kacper','Łukasz','Damian')),
  category   text    not null check (category in ('Gry','Minecraft','League of Legends','Życie','Mechanika')),
  quote      text    not null check (char_length(quote)   between 1 and 500),
  context    text    not null check (char_length(context) between 1 and 200),
  rating     text    not null check (rating in ('PRAWDA','PÓŁPRAWDA','MANIPULACJA','FAŁSZ','FAŁSZ OSTATECZNY')),
  date       date    not null,
  reason     text    not null check (char_length(reason)  between 1 and 1000),
  likes      integer not null default 0 check (likes >= 0),
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.quotes enable row level security;

-- Odwiedzający widzą tylko zaakceptowane wpisy
create policy "anon czyta zaakceptowane" on public.quotes
  for select to anon using (approved = true);

-- Odwiedzający mogą tylko dodać wpis oczekujący (bez zmiany polubień i akceptacji)
create policy "anon dodaje oczekujace" on public.quotes
  for insert to anon with check (approved = false and likes = 0);

-- Potwierdzenia: jedyna dozwolona zmiana, +1 / -1 na zaakceptowanym wpisie
create function public.like_quote(qid bigint, delta int)
returns void language sql security definer set search_path = public as $$
  update public.quotes
     set likes = greatest(0, likes + case when delta > 0 then 1 else -1 end)
   where id = qid and approved = true;
$$;
grant execute on function public.like_quote(bigint, int) to anon;
