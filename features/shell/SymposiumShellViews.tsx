"use client";

import Image from "next/image";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { ArrowLeft, ArrowRight, Home } from "lucide-react";
import { rooms, type Room, type RoomId } from "@/lib/mockData";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";
import { canonicalRouteForRoom } from "@/features/navigation/canonicalRoute";

const getRoom = (roomId: RoomId) => rooms.find((room) => room.id === roomId) ?? rooms[0];
type Theme = "day" | "night";
type EntryMode = "loading" | "approach" | "auth" | "complete";

export function RenderPreloadDeck({ sources }: { sources: string[] }) {

  return (

    <div className="render-preload" aria-hidden="true">

      {sources.map((render) => (

        <Image key={render} src={render} alt="" width={1} height={1} loading="eager" unoptimized />

      ))}

    </div>

  );

}



export function EntrySequence({

  theme,

  entranceRender,

  mode,

  authError,

  authLoaded,

  clerkEnabled,

  onLocalPreview,

  preloadRenders

}: {

  theme: Theme;

  entranceRender: string;

  mode: EntryMode;

  authError: string;

  authLoaded: boolean;

  clerkEnabled: boolean;

  onLocalPreview: () => void;

  preloadRenders: string[];

}) {

  return (

    <main className={`entry-sequence ${theme}`} aria-label="Approaching Symposium">

      <Image

        src={entranceRender}

        alt="Greco-futurist Symposium building above the Aegean sea"

        fill

        priority

        sizes="100vw"

        className="entry-image"

      />

      <RenderPreloadDeck sources={preloadRenders} />

      <div className="entry-veil" />

      <div className="entry-stair-lines" aria-hidden="true">

        {Array.from({ length: 9 }).map((_, index) => (

          <span key={index} />

        ))}

      </div>

      <div className="entry-copy">

        <p>Welcome to the Symposium</p>

      </div>

      {mode === "auth" ? (

        <EntryAuthPanel

          authError={authError}

          authLoaded={authLoaded}

          clerkEnabled={clerkEnabled}

          onLocalPreview={onLocalPreview}

        />

      ) : null}

    </main>

  );

}



function EntryAuthPanel({

  authError,

  authLoaded,

  clerkEnabled,

  onLocalPreview

}: {

  authError: string;

  authLoaded: boolean;

  clerkEnabled: boolean;

  onLocalPreview: () => void;

}) {

  return (

    <section className="entry-auth" aria-label="Symposium sign in">

      {clerkEnabled ? (

        <div className="entry-auth-form clerk-auth-actions">

          <SignInButton mode="modal">

            <button type="button" disabled={!authLoaded}>

              Sign in

            </button>

          </SignInButton>

          <SignUpButton mode="modal">

            <button type="button" disabled={!authLoaded}>

              Create account

            </button>

          </SignUpButton>

        </div>

      ) : (

        <div className="entry-auth-form">

          <button type="button" onClick={onLocalPreview} disabled={!authLoaded}>

            Enter local preview

          </button>

        </div>

      )}



      {authError ? <p className="auth-error">{authError}</p> : null}

    </section>

  );

}



export function HallView({ onEnter }: { onEnter: (roomId: RoomId) => void }) {

  const doorIds: Array<Exclude<RoomId, "hall">> = [

    "office",

    "amphitheater",

    "funding",

    "library",

    "communities",

    "symposium",

    "opportunities"

  ];



  return (

    <div className="hall-layout">

      <section className="hall-world" aria-label="Main hall">

        {doorIds.map((roomId) => {

          const room = getRoom(roomId);

          return (

            <CanonicalLink

              key={room.id}

              className={`hall-door hall-door-${room.id}`}

              aria-label={`Enter ${room.name}`}

              route={canonicalRouteForRoom(room.id)}

              onNavigate={() => onEnter(room.id)}

            >

              <span className="hall-hover-label">{room.name}</span>

            </CanonicalLink>

          );

        })}

      </section>

    </div>

  );

}



export function ViewNav({

  canGoBack,

  canGoForward,

  onBack,

  onForward,

  onHome

}: {

  canGoBack: boolean;

  canGoForward: boolean;

  onBack: () => void;

  onForward: () => void;

  onHome: () => void;

}) {

  return (

    <nav className="view-nav" aria-label="View history">

      <button type="button" title="Back" disabled={!canGoBack} onClick={onBack}>

        <ArrowLeft size={17} />

      </button>

      <button type="button" title="Forward" disabled={!canGoForward} onClick={onForward}>

        <ArrowRight size={17} />

      </button>

      <CanonicalLink route={{ kind: "hall" }} onNavigate={onHome} title="Main hall">

        <Home size={17} />

      </CanonicalLink>

    </nav>

  );

}



export function OfficeDeskView({

  room,

  onOpenSaved,

  onOpenNotes

}: {

  room: Room;

  onOpenSaved: () => void;

  onOpenNotes: () => void;

}) {

  return (

    <div className="office-desk-view">

      <RoomRender room={room} onOpenNotebook={onOpenNotes} onOpenSaved={onOpenSaved} />

    </div>

  );

}



export function PatronageLobbyView({

  room,

  onOpenCivic,

  onOpenPrivate

}: {

  room: Room;

  onOpenCivic: () => void;

  onOpenPrivate: () => void;

}) {

  return (

    <div className="patronage-lobby-view">

      <RoomRender

        room={room}

        onOpenNotebook={() => undefined}

        onOpenCivic={onOpenCivic}

        onOpenPrivate={onOpenPrivate}

        showPatronageHotspots

      />

    </div>

  );

}



export function RoomRender({

  room,

  onOpenNotebook,

  onOpenSaved,

  onOpenCivic,

  onOpenPrivate,

  showPatronageHotspots = false

}: {

  room: Room;

  onOpenNotebook: () => void;

  onOpenSaved?: () => void;

  onOpenCivic?: () => void;

  onOpenPrivate?: () => void;

  showPatronageHotspots?: boolean;

}) {

  const isOffice = room.id === "office";

  const isPatronage = room.id === "funding";



  return (

    <section

      className={`room-render room-render-${room.id}`}

      aria-label={`${room.name} rendered room`}

    >

      {isOffice ? (

        <div className="room-hotspots" aria-label="Office desk areas">

          <>

            <CanonicalLink

              className="office-hotspot office-hotspot-notes"

              route={{ kind: "workspace", view: "notes" }}

              onNavigate={onOpenNotebook}

              aria-label="Open notes"

            >

              <span>Notes</span>

            </CanonicalLink>

            <CanonicalLink

              className="office-hotspot office-hotspot-saved"

              route={{ kind: "workspace", view: "saved" }}

              onNavigate={onOpenSaved ?? (() => undefined)}

              aria-label="Saved for later"

            >

              <span>Saved for later</span>

            </CanonicalLink>

          </>

        </div>

      ) : null}

      {isPatronage && showPatronageHotspots ? (

        <div className="room-hotspots patronage-hotspots" aria-label="Patronage sections">

          <CanonicalLink

            className="patronage-hotspot patronage-hotspot-civic"

            route={{ kind: "funding", view: "civic" }}

            onNavigate={onOpenCivic ?? (() => undefined)}

            aria-label="Open Civic Patronage"

          >

            <span>Civic</span>

          </CanonicalLink>

          <CanonicalLink

            className="patronage-hotspot patronage-hotspot-private"

            route={{ kind: "funding", view: "private" }}

            onNavigate={onOpenPrivate ?? (() => undefined)}

            aria-label="Open Private Patronage"

          >

            <span>Private</span>

          </CanonicalLink>

        </div>

      ) : null}

    </section>

  );

}
