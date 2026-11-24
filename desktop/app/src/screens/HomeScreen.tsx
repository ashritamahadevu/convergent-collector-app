import { useEffect, useRef, useState } from "react";
import BrandLogo from "../components/BrandLogo";
import Toolbar from "../components/Toolbar";

const defaultGoal = "Raise your comprehension score to 80%.";

const assetPathPrefix = "./assets/home";
const imgEllipse12 = `${assetPathPrefix}/e05a2.svg`;
const imgGroup = `${assetPathPrefix}/fd0ec.svg`;
const imgGroup1 = `${assetPathPrefix}/416df.svg`;
const imgGroup2 = `${assetPathPrefix}/a43e2.svg`;
const imgGroup3 = `${assetPathPrefix}/c8c72.svg`;
const imgGroup4 = `${assetPathPrefix}/5f1fb.svg`;
const imgGroup5 = `${assetPathPrefix}/2fd73.svg`;
const imgGroup27 = `${assetPathPrefix}/0687b.svg`;
const goblinSprite = `${assetPathPrefix}/goblin_sprite.png`;

const homeMockData = {
  goblin: { name: "Grub", rank: "Knight" },
  stats: [
    {
      title: "Happiness",
      detail: "Consistency",
      value: "78%",
      filled: 8,
    },
    {
      title: "Dexterity",
      detail: "Weekly comprehension score",
      value: "47%",
      filled: 5,
    },
    {
      title: "EXP",
      detail: "Progress to next rank",
      value: "64%",
      filled: 6,
    },
    {
      title: "Decay",
      detail: "Performance on follow up checks",
      value: "Low",
      filled: 2,
    },
    {
      title: "Rank",
      detail: "Percentile vs other goblins",
      value: "Top 18%",
      filled: 8,
    },
  ],
  recentPastes: [2, 3, 5],
} as const;

const pasteScoreColors = ["#58805F", "#6A9A71", "#74AB7B"] as const;

function User({ className }: { className?: string }) {
  return (
    <div
      className={className || "h-[50px] relative w-[246px]"}
      data-node-id="1:111"
      data-name="User"
    >
      <div
        className="absolute flex inset-[20%_0_20%_27.64%] items-center justify-center"
        data-node-id="1:112"
        style={{ containerType: "size" }}
      >
        <div className="flex-none h-[100cqh] w-[100cqw]">
          <p className="[word-break:break-word] font-['Inter:Regular'] font-normal leading-[0] not-italic relative text-[20px] text-white tracking-[0.4px] whitespace-nowrap">
            <span className="leading-[1.5]">{`Welcome, `}</span>
            <span className="font-['Inter:Semi_Bold'] font-semibold leading-[1.5] text-[#bddbc1]">
              user-31
            </span>
          </p>
        </div>
      </div>
      <div className="absolute aspect-[100/100] left-0 right-[79.67%] top-0" data-node-id="1:113">
        <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgEllipse12} />
      </div>
    </div>
  );
}

function HomeToolbar({ className }: { className?: string }) {
  return (
    <div
      className={className || "h-[468px] relative w-[75px]"}
      data-node-id="1:4"
      data-name="Home Toolbar"
    >
      <div
        className="absolute flex inset-0 items-center justify-center"
        data-node-id="1:5"
        style={{ containerType: "size" }}
      >
        <div className="-rotate-90 flex-none h-[100cqw] w-[100cqh]">
          <div className="border border-[rgba(189,219,193,0.5)] border-solid opacity-50 relative rounded-[100px] size-full" />
        </div>
      </div>
      <div
        className="absolute flex inset-[0_83.97%_0_0] items-center justify-center"
        data-node-id="1:6"
        style={{ containerType: "size" }}
      >
        <div className="-rotate-90 flex-none h-[100cqw] w-[100cqh]">
          <div className="bg-[#bddbc1] border border-[rgba(189,219,193,0.5)] border-solid relative rounded-[100px] size-full" />
        </div>
      </div>
      <div
        className="absolute contents inset-[29.33%_88.89%_28%_4.27%]"
        data-node-id="1:7"
        style={{ containerType: "size" }}
        data-name="Home"
      >
        <div
          className="absolute flex inset-[32.58%_89.46%_31.25%_4.84%] items-center justify-center"
          data-node-id="1:10"
          style={{ containerType: "size" }}
        >
          <div className="-rotate-90 flex-none h-[100cqw] w-[100cqh]">
            <div
              className="mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-2.44px_-2.667px] mask-size-[32px_32px] relative size-full"
              style={{ maskImage: `url("${imgGroup}")` }}
              data-name="Group"
            >
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgGroup1} />
            </div>
          </div>
        </div>
      </div>
      <div
        className="absolute contents inset-[29.33%_60.68%_28%_32.48%]"
        data-node-id="1:12"
        style={{ containerType: "size" }}
        data-name="History Light"
      >
        <div
          className="absolute flex inset-[32.89%_61.25%_31.56%_33.05%] items-center justify-center"
          data-node-id="1:15"
          style={{ containerType: "size" }}
        >
          <div className="-rotate-90 flex-none h-[100cqw] w-[100cqh]">
            <div
              className="mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-2.667px_-2.667px] mask-size-[32px_32px] relative size-full"
              style={{ maskImage: `url("${imgGroup2}")` }}
              data-name="Group"
            >
              <div className="absolute inset-[-4.69%]">
                <img alt="" className="block max-w-none size-full" src={imgGroup3} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        className="absolute contents inset-[29.33%_32.48%_28%_60.68%]"
        data-node-id="1:20"
        style={{ containerType: "size" }}
        data-name="Growth Light"
      >
        <div
          className="absolute flex inset-[32.89%_33.05%_31.56%_61.25%] items-center justify-center"
          data-node-id="1:23"
          style={{ containerType: "size" }}
        >
          <div className="-rotate-90 flex-none h-[100cqw] w-[100cqh]">
            <div
              className="mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-2.667px_-2.667px] mask-size-[32px_32px] relative size-full"
              style={{ maskImage: `url("${imgGroup2}")` }}
              data-name="Group"
            >
              <div className="absolute inset-[-4.69%]">
                <img alt="" className="block max-w-none size-full" src={imgGroup4} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        className="absolute contents inset-[29.33%_4.27%_28%_88.89%]"
        data-node-id="1:27"
        style={{ containerType: "size" }}
        data-name="Map Light"
      >
        <div
          className="absolute flex inset-[31.96%_4.63%_30.63%_89.24%] items-center justify-center"
          data-node-id="1:30"
          style={{ containerType: "size" }}
        >
          <div className="-rotate-90 flex-none h-[100cqw] w-[100cqh]">
            <div
              className="mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-1.973px_-1.659px] mask-size-[32px_32px] relative size-full"
              style={{ maskImage: `url("${imgGroup}")` }}
              data-name="Group"
            >
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgGroup5} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoblinCard() {
  return (
    <section className="absolute left-[174px] top-[346px] h-[400px] w-[582px]">
      <img
        alt=""
        className="absolute left-[159px] top-[64px] h-[214px] w-[264px]"
        src={goblinSprite}
        style={{ imageRendering: "pixelated" }}
      />
      <p className="absolute top-[302px] left-0 w-full text-center font-['Inter:Bold'] text-[30px] leading-[45px] font-bold text-[#bddbc1]">
        {homeMockData.goblin.name}
      </p>
      <p className="absolute top-[346px] left-1/2 flex h-[28px] -translate-x-1/2 items-center rounded-full bg-[#bddbc1] px-[14px] font-['Inter:Bold'] text-[14px] leading-[21px] font-bold text-[#0a0c0b]">
        {homeMockData.goblin.rank}
      </p>
    </section>
  );
}

function StatsCard() {
  return (
    <section className="home-glass-card absolute left-[782px] top-[346px] h-[400px] w-[582px] rounded-[32px]">
      <h2 className="absolute left-[27px] top-[25px] font-['Inter:Semi_Bold'] text-[14px] leading-[21px] font-semibold text-[#6c7b6e]">
        Stats
      </h2>
      <div className="absolute top-[62px] right-[27px] left-[27px]">
        {homeMockData.stats.map((stat, rowIndex) => (
          <div
            className={`relative h-[60px] ${rowIndex > 0 ? "border-t border-white/[0.08]" : ""}`}
            key={stat.title}
          >
            <p className="absolute top-[10px] left-0 font-['Inter:Semi_Bold'] text-[16px] leading-[24px] font-semibold text-[#bddbc1]">
              {stat.title}
            </p>
            <p className="absolute top-[33px] left-0 font-['Inter:Medium'] text-[13px] leading-[20px] font-medium text-[#74ab7b]">
              {stat.detail}
            </p>
            <p className="absolute top-[10px] right-0 font-['Inter:Semi_Bold'] text-[16px] leading-[24px] font-semibold text-[#bddbc1]">
              {stat.value}
            </p>
            <div className="absolute top-[36px] right-0 flex gap-[3px]" aria-hidden="true">
              {Array.from({ length: 10 }, (_, blockIndex) => (
                <span
                  className={`h-[6px] w-[12px] rounded-[1.5px] ${
                    blockIndex < stat.filled ? "bg-[#74ab7b]" : "bg-[#2b3530]"
                  }`}
                  key={blockIndex}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PasteDial({ score, index }: { score: number; index: number }) {
  const filledTicks = score === 2 ? 24 : score === 3 ? 36 : 60;

  return (
    <article className="relative h-[126px] w-[174px]">
      <div className="absolute top-[11px] left-[46px] h-[82px] w-[82px]" aria-hidden="true">
        {Array.from({ length: 60 }, (_, tickIndex) => (
          <span
            className={`absolute top-0 left-[39.9px] h-[11px] w-[2.2px] origin-[1.1px_41px] rounded-full ${
              tickIndex < filledTicks ? "bg-[#74ab7b]" : "bg-[#26302a]"
            }`}
            key={tickIndex}
            style={{ transform: `rotate(${-tickIndex * 6}deg)` }}
          />
        ))}
        <strong
          className="absolute inset-0 flex items-center justify-center font-['Inter:Semi_Bold'] text-[22px] leading-[33px] font-semibold"
          style={{ color: pasteScoreColors[index] }}
        >
          {score}/5
        </strong>
      </div>
      <p className="absolute bottom-[7px] left-0 w-full text-center font-['Inter:Semi_Bold'] text-[13px] leading-[20px] font-semibold text-[#74ab7b]">
        Recent Paste #{index + 1}
      </p>
    </article>
  );
}

function RecentPastesCard() {
  return (
    <section className="absolute top-[783px] left-[782px] h-[200px] w-[582px]">
      <div className="absolute inset-0 rounded-[20px] border border-[rgba(189,219,193,0.5)] bg-[#2b2b2b] opacity-50" />
      <h2 className="absolute top-[22px] left-[19px] font-['Inter:Semi_Bold'] text-[14px] leading-[21px] font-semibold text-[#748376]">
        Recent pastes
      </h2>
      <div className="absolute top-[53px] left-[20px] flex gap-[10px]">
        {homeMockData.recentPastes.map((score, index) => (
          <PasteDial index={index} key={index} score={score} />
        ))}
      </div>
    </section>
  );
}

export default function DashboardDrawbridge() {
  const [goal, setGoal] = useState(
    () => window.localStorage.getItem("drawbridge-weekly-goal") ?? defaultGoal,
  );
  const [draft, setDraft] = useState(goal);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const beginEditing = () => {
    setDraft(goal);
    setIsEditing(true);
  };

  return (
    <div
      className="relative size-full"
      data-node-id="1:98"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 1440 1024' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(0.0000042832 -184.55 132.12 0.0000030663 720 2357.5)'><stop stop-color='rgba(189,219,193,1)' offset='0'/><stop stop-color='rgba(144,167,147,1)' offset='0.25'/><stop stop-color='rgba(122,141,124,1)' offset='0.375'/><stop stop-color='rgba(100,115,102,1)' offset='0.5'/><stop stop-color='rgba(77,88,79,1)' offset='0.625'/><stop stop-color='rgba(55,62,56,1)' offset='0.75'/><stop stop-color='rgba(32,36,33,1)' offset='0.875'/><stop stop-color='rgba(21,23,21,1)' offset='0.9375'/><stop stop-color='rgba(10,10,10,1)' offset='1'/></radialGradient></defs></svg>\")",
      }}
      data-name="Dashboard Drawbridge"
    >
      <div className="absolute inset-[78.42%_-4.31%_-0.03%_-4.24%]" data-node-id="1:99">
        <div className="absolute inset-[-2.26%_-0.32%]">
          <img alt="" className="block max-w-none size-full" src={imgGroup27} />
        </div>
      </div>
      <Toolbar active="home" />
      <div className="absolute contents left-[174px] top-[41px]" data-node-id="1:108">
        <div className="absolute contents inset-[4.2%_75.49%_91.41%_12.08%]" data-node-id="1:109">
          <BrandLogo className="absolute top-[45px] left-[184px] h-[70px] w-[190px] object-contain" />
        </div>
        <User className="absolute flex h-[50px] items-center justify-center left-[1118px] top-[41px] w-[246px]" />
        <GoblinCard />
        <StatsCard />
        <div
          className="-translate-x-1/2 absolute contents left-[calc(50%+49px)] top-[140px]"
          data-node-id="1:126"
        >
          <div className="absolute contents left-[174px] top-[140px]" data-node-id="1:127">
            <div
              className="absolute bg-[#2b2b2b] border border-[rgba(189,219,193,0.5)] border-solid inset-[13.67%_63.61%_69.82%_12.08%] opacity-50 rounded-[20px]"
              data-node-id="1:128"
            />
            <p
              className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[26px] leading-[1.5] left-[191px] not-italic text-[17px] text-[rgba(189,219,193,0.5)] top-[153px] tracking-[0.34px] w-[124px]"
              data-node-id="1:129"
            >
              Weak Point #1
            </p>
            <p
              className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[26px] leading-[1.5] left-[189px] not-italic text-[17px] text-[rgba(189,219,193,0.5)] top-[270px] tracking-[0.34px] w-[124px]"
              data-node-id="1:130"
            >
              coalesce.c
            </p>
            <p
              className="[word-break:break-word] absolute font-['Inter:Medium'] font-medium h-[89px] leading-[1.5] left-[191px] not-italic text-[30px] text-white top-[180px] tracking-[0.6px] w-[319px]"
              data-node-id="1:131"
            >
              Coalescing free blocks
            </p>
          </div>
          <div className="absolute contents left-[594px] top-[140px]" data-node-id="1:132">
            <div
              className="absolute bg-[#2b2b2b] border border-[rgba(189,219,193,0.5)] border-solid inset-[13.67%_34.44%_69.82%_41.25%] opacity-50 rounded-[20px]"
              data-node-id="1:133"
            />
            <p
              className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold leading-[1.5] left-[611px] not-italic text-[17px] text-[rgba(189,219,193,0.5)] top-[153px] tracking-[0.34px] whitespace-nowrap"
              data-node-id="1:134"
            >
              Weak Point #2
            </p>
            <p
              className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[26px] leading-[1.5] left-[609px] not-italic text-[17px] text-[rgba(189,219,193,0.5)] top-[270px] tracking-[0.34px] w-[124px]"
              data-node-id="1:135"
            >
              coalesce.c
            </p>
            <p
              className="[word-break:break-word] absolute font-['Inter:Medium'] font-medium h-[89px] leading-[1.5] left-[611px] not-italic text-[30px] text-white top-[180px] tracking-[0.6px] w-[319px]"
              data-node-id="1:136"
            >
              Coalescing free blocks
            </p>
          </div>
          <div className="absolute contents left-[1014px] top-[140px]" data-node-id="1:137">
            <div
              className="absolute bg-[#2b2b2b] border border-[rgba(189,219,193,0.5)] border-solid inset-[13.67%_5.28%_69.82%_70.42%] opacity-50 rounded-[20px]"
              data-node-id="1:138"
            />
            <p
              className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold leading-[1.5] left-[1031px] not-italic text-[17px] text-[rgba(189,219,193,0.5)] top-[153px] tracking-[0.34px] whitespace-nowrap"
              data-node-id="1:139"
            >
              Weak Point #3
            </p>
            <p
              className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold leading-[1.5] left-[1029px] not-italic text-[17px] text-[rgba(189,219,193,0.5)] top-[270px] tracking-[0.34px] whitespace-nowrap"
              data-node-id="1:140"
            >
              coalesce.c
            </p>
            <p
              className="[word-break:break-word] absolute font-['Inter:Medium'] font-medium h-[89px] leading-[1.5] left-[1031px] not-italic text-[30px] text-white top-[180px] tracking-[0.6px] w-[319px]"
              data-node-id="1:141"
            >
              Coalescing free blocks
            </p>
          </div>
        </div>
        <div className="absolute contents left-[174px] top-[783px]" data-node-id="1:142">
          <div
            className="absolute bg-[#2b2b2b] border border-[rgba(189,219,193,0.5)] border-solid inset-[76.46%_47.47%_4%_12.08%] opacity-50 rounded-[20px]"
            data-node-id="1:143"
          />
          <p
            className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[26px] leading-[1.5] left-[194px] not-italic text-[17px] text-[rgba(189,219,193,0.5)] top-[805px] tracking-[0.34px] w-[261px]"
            data-node-id="1:144"
          >
            Weekly Goal Mon Nov 9 2026
          </p>
          <div
            className="absolute bg-[rgba(217,217,217,0)] border border-[rgba(189,219,193,0.5)] border-solid inset-[78.03%_48.82%_18.26%_46.53%] opacity-50 rounded-[10px]"
            data-node-id="1:145"
          />
          <p
            className="[word-break:break-word] absolute font-['Inter:Medium'] font-medium h-[26px] leading-[1.5] left-[687px] not-italic text-[17px] text-[rgba(189,219,193,0.5)] top-[805px] tracking-[0.34px] w-[34px]"
            data-node-id="1:146"
          >
            edit
          </p>
          <button
            aria-label="Edit weekly goal"
            className="interactive-control absolute h-[38px] left-[670px] rounded-[10px] top-[799px] w-[67px]"
            onClick={beginEditing}
            type="button"
          />
          {isEditing ? (
            <input
              aria-label="Weekly goal"
              className="goal-editor absolute bg-transparent font-['Inter:Medium'] font-medium h-[50px] left-[193px] leading-[1.5] text-[#f6f6f6] text-[30px] top-[843px] tracking-[0.6px] w-[544px]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setGoal(draft);
                  window.localStorage.setItem("drawbridge-weekly-goal", draft);
                  setIsEditing(false);
                }
                if (event.key === "Escape") {
                  setDraft(goal);
                  setIsEditing(false);
                }
              }}
              ref={inputRef}
              value={draft}
            />
          ) : (
            <p
              className="[word-break:break-word] absolute font-['Inter:Medium'] font-medium h-[89px] leading-[0] left-[193px] not-italic text-[#bddbc1] text-[30px] top-[850px] tracking-[0.6px] w-[544.019px]"
              data-node-id="1:147"
            >
              {goal === defaultGoal ? (
                <>
                  <span className="leading-[1.5] text-[#f6f6f6]">
                    Raise your comprehension score to{" "}
                  </span>
                  <span className="leading-[1.5] text-[#74ab7b]">80%.</span>
                </>
              ) : (
                <span className="leading-[1.5] text-[#f6f6f6]">{goal}</span>
              )}
            </p>
          )}
        </div>
        <RecentPastesCard />
      </div>
    </div>
  );
}
