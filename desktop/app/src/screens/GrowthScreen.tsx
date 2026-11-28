import { useLayoutEffect, useRef } from "react";
import BrandLogo from "../components/BrandLogo";
import Toolbar from "../components/Toolbar";

const assetPathPrefix = "./assets/growth";
const imgEllipse12 = `${assetPathPrefix}/e05a2.svg`;
const imgVector = `${assetPathPrefix}/d8e67.svg`;
const imgVector1 = `${assetPathPrefix}/49447.svg`;
const imgVector2 = `${assetPathPrefix}/53c28.svg`;
const imgVector3 = `${assetPathPrefix}/ea567.svg`;
const imgVector4 = `${assetPathPrefix}/9d14b.svg`;
const imgVector5 = `${assetPathPrefix}/86c29.svg`;
const imgVector6 = `${assetPathPrefix}/f6286.svg`;
const imgGroup = `${assetPathPrefix}/fd0ec.svg`;
const imgGroup1 = `${assetPathPrefix}/2fd73.svg`;
const imgGroup2 = `${assetPathPrefix}/a43e2.svg`;
const imgGroup3 = `${assetPathPrefix}/73be8.svg`;
const imgColumn01 = `${assetPathPrefix}/462e1.svg`;
const imgColumn04 = `${assetPathPrefix}/2c6e4.svg`;
const imgColumn11 = `${assetPathPrefix}/132cc.svg`;
const imgColumn21 = `${assetPathPrefix}/cb5f1.svg`;
const imgColumn42 = `${assetPathPrefix}/8cecd.svg`;
const imgColumn46 = `${assetPathPrefix}/81a0a.svg`;
const imgColumn59 = `${assetPathPrefix}/df4b8.svg`;
const imgVector7 = `${assetPathPrefix}/f5257.svg`;
const imgVector8 = `${assetPathPrefix}/c343a.svg`;

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

function Growth({ className }: { className?: string }) {
  return (
    <div
      className={className || "aspect-[24/24] relative w-[50px]"}
      data-node-id="1:76"
      data-name="Growth"
    >
      <div
        className="absolute contents inset-[8.33%_8.37%_8.33%_8.33%]"
        data-node-id="1:79"
        data-name="Group"
      >
        <div
          className="absolute inset-[8.33%_8.37%_8.33%_8.33%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-4.167px_-4.167px] mask-size-[50px_50px]"
          data-node-id="1:80"
          style={{ maskImage: `url("${imgVector}")` }}
          data-name="Vector"
        >
          <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgVector1} />
        </div>
      </div>
    </div>
  );
}

function HistoryLight({ className }: { className?: string }) {
  return (
    <div
      className={className || "aspect-[24/24] relative w-[50px]"}
      data-node-id="1:68"
      data-name="History Light"
    >
      <div className="absolute contents inset-[8.33%]" data-node-id="1:71" data-name="Group">
        <div
          className="absolute inset-[62.5%_45.83%_29.17%_29.17%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-14.583px_-31.25px] mask-size-[50px_50px]"
          data-node-id="1:72"
          style={{ maskImage: `url("${imgVector2}")` }}
          data-name="Vector"
        >
          <div className="absolute inset-[-36%_-12%]">
            <img alt="" className="block max-w-none size-full" src={imgVector3} />
          </div>
        </div>
        <div
          className="absolute inset-[54.17%_62.5%_37.5%_29.17%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-14.583px_-27.083px] mask-size-[50px_50px]"
          data-node-id="1:73"
          style={{ maskImage: `url("${imgVector2}")` }}
          data-name="Vector"
        >
          <div className="absolute inset-[-36%]">
            <img alt="" className="block max-w-none size-full" src={imgVector4} />
          </div>
        </div>
        <div
          className="absolute inset-[8.33%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-4.167px_-4.167px] mask-size-[50px_50px]"
          data-node-id="1:74"
          style={{ maskImage: `url("${imgVector2}")` }}
          data-name="Vector"
        >
          <div className="absolute inset-[-3.6%]">
            <img alt="" className="block max-w-none size-full" src={imgVector5} />
          </div>
        </div>
        <div
          className="absolute inset-[8.33%_8.33%_58.33%_58.33%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-29.167px_-4.167px] mask-size-[50px_50px]"
          data-node-id="1:75"
          style={{ maskImage: `url("${imgVector2}")` }}
          data-name="Vector"
        >
          <div className="absolute inset-[-9%]">
            <img alt="" className="block max-w-none size-full" src={imgVector6} />
          </div>
        </div>
      </div>
    </div>
  );
}

function GrowthToolbar({ className }: { className?: string }) {
  return (
    <div
      className={className || "h-[468px] relative w-[75px]"}
      data-node-id="1:81"
      data-name="Growth Toolbar"
    >
      <div
        className="absolute flex inset-0 items-center justify-center"
        data-node-id="1:82"
        style={{ containerType: "size" }}
      >
        <div className="-rotate-90 flex-none h-[100cqw] w-[100cqh]">
          <div className="border border-[rgba(189,219,193,0.5)] border-solid opacity-50 relative rounded-[100px] size-full" />
        </div>
      </div>
      <div
        className="absolute flex inset-[0_27.78%_0_56.2%] items-center justify-center"
        data-node-id="1:83"
        style={{ containerType: "size" }}
      >
        <div className="-rotate-90 flex-none h-[100cqw] w-[100cqh]">
          <div className="bg-[#bddbc1] border border-[rgba(189,219,193,0.5)] border-solid relative rounded-[100px] size-full" />
        </div>
      </div>
      <div
        className="absolute contents inset-[29.33%_4.27%_28%_88.89%]"
        data-node-id="1:84"
        style={{ containerType: "size" }}
        data-name="Map Light"
      >
        <div
          className="absolute flex inset-[31.96%_4.63%_30.63%_89.24%] items-center justify-center"
          data-node-id="1:87"
          style={{ containerType: "size" }}
        >
          <div className="-rotate-90 flex-none h-[100cqw] w-[100cqh]">
            <div
              className="mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-1.973px_-1.659px] mask-size-[32px_32px] relative size-full"
              style={{ maskImage: `url("${imgGroup}")` }}
              data-name="Group"
            >
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgGroup1} />
            </div>
          </div>
        </div>
      </div>
      <div
        className="absolute contents inset-[29.33%_88.89%_28%_4.27%]"
        data-node-id="1:90"
        style={{ containerType: "size" }}
        data-name="Home Light"
      >
        <div
          className="absolute flex inset-[32.89%_89.51%_31.55%_4.9%] items-center justify-center"
          data-node-id="1:93"
          style={{ containerType: "size" }}
        >
          <div className="-rotate-90 flex-none h-[100cqw] w-[100cqh]">
            <div
              className="mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-2.662px_-2.911px] mask-size-[32px_32px] relative size-full"
              style={{ maskImage: `url("${imgGroup2}")` }}
              data-name="Group"
            >
              <div className="absolute inset-[-4.78%_-4.69%]">
                <img alt="" className="block max-w-none size-full" src={imgGroup3} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <HistoryLight className="absolute flex items-center justify-center left-[152px] size-[32px] top-[22px]" />
      <Growth className="absolute flex items-center justify-center left-[284px] size-[32px] top-[22px]" />
    </div>
  );
}

export default function GrowthDrawbridge() {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const columns = rootRef.current?.querySelectorAll<HTMLElement>('[data-name^="column-"]');
    columns?.forEach((column, index) => {
      column.style.animationDelay = `${index * 12}ms`;
    });
  }, []);

  return (
    <div
      className="growth-screen relative size-full"
      data-node-id="1:323"
      ref={rootRef}
      data-name="Growth Drawbridge"
    >
      <Toolbar active="growth" />
      <div className="absolute contents left-[184px] top-[55px]" data-node-id="1:333">
        <div className="absolute contents inset-[5.86%_74.79%_89.75%_12.78%]" data-node-id="1:334">
          <BrandLogo className="absolute top-[45px] left-[184px] h-[70px] w-[190px] object-contain" />
        </div>
        <div
          className="-translate-x-1/2 absolute contents left-[calc(50%+59px)] top-[164px]"
          data-node-id="1:336"
        >
          <div
            className="absolute contents inset-[16.02%_80.42%_81.35%_12.78%]"
            data-node-id="1:337"
            style={{ containerType: "size" }}
          >
            <div
              className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold inset-[16.02%_80.42%_81.35%_12.78%] leading-[0] not-italic text-[#bddbc1] text-[20px] tracking-[0.4px]"
              data-node-id="1:338"
            >
              <p className="leading-[1.5] mb-0">Summary</p>
              <p className="leading-[1.5]">​</p>
            </div>
          </div>
          <div
            className="absolute contents inset-[16.11%_75.35%_81.35%_19.72%]"
            data-node-id="1:339"
            style={{ containerType: "size" }}
          >
            <p
              className="[word-break:break-word] absolute font-['Inter:Medium'] font-medium inset-[16.11%_75.35%_81.35%_19.72%] leading-[1.5] not-italic opacity-50 text-[#bddbc1] text-[20px] tracking-[0.4px]"
              data-node-id="1:340"
            >
              Topics
            </p>
          </div>
          <div
            className="-translate-x-1/2 absolute contents left-[calc(50%+59px)] top-[213px]"
            data-node-id="1:341"
          >
            <div className="absolute contents left-[184px] top-[213px]" data-node-id="1:342">
              <div
                className="absolute bg-[#2b2b2b] border border-[#74ab7b] border-solid inset-[20.8%_62.92%_62.7%_12.78%] opacity-50 rounded-[20px]"
                data-node-id="1:343"
              />
              <p
                className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[26px] leading-[1.5] left-[212px] not-italic text-[#bddbc1] text-[17px] top-[226px] tracking-[0.34px] w-[229px]"
                data-node-id="1:344"
              >
                This week’s first try score
              </p>
              <p
                className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[26px] leading-[1.5] left-[212px] not-italic text-[#bddbc1] text-[17px] top-[343px] tracking-[0.34px] w-[193px] whitespace-nowrap"
                data-node-id="1:345"
              >
                Latest weekly average
              </p>
              <p
                className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[112px] leading-[1.5] left-[212px] not-italic text-[#74ab7b] text-[75px] top-[242px] tracking-[1.5px] w-[181px]"
                data-node-id="1:346"
              >
                47%
              </p>
            </div>
            <div
              className="-translate-x-1/2 absolute contents left-[calc(50%+59px)] top-[213px]"
              data-node-id="1:347"
            >
              <div
                className="absolute bg-[#2b2b2b] border border-[#74ab7b] border-solid inset-[20.8%_33.75%_62.7%_41.94%] opacity-50 rounded-[20px]"
                data-node-id="1:348"
              />
              <p
                className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[26px] leading-[1.5] left-[629px] not-italic text-[#bddbc1] text-[17px] top-[226px] tracking-[0.34px] w-[229px]"
                data-node-id="1:349"
              >
                Weekly goal
              </p>
              <p
                className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[26px] leading-[1.5] left-[629px] not-italic text-[#bddbc1] text-[17px] top-[343px] tracking-[0.34px] w-[169px]"
                data-node-id="1:350"
              >
                Set on Mon, Nov 9
              </p>
              <p
                className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[112px] leading-[1.5] left-[629px] not-italic text-[#74ab7b] text-[75px] top-[242px] tracking-[1.5px] w-[181px]"
                data-node-id="1:351"
              >
                80%
              </p>
            </div>
            <div
              className="-translate-x-1/2 absolute contents left-[calc(50%+479px)] top-[213px]"
              data-node-id="1:352"
            >
              <div
                className="absolute bg-[#2b2b2b] border border-[#74ab7b] border-solid inset-[20.8%_4.58%_62.7%_71.11%] opacity-50 rounded-[20px]"
                data-node-id="1:353"
              />
              <p
                className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[26px] leading-[1.5] left-[1050px] not-italic text-[#bddbc1] text-[17px] top-[226px] tracking-[0.34px] w-[229px]"
                data-node-id="1:354"
              >
                Gap to goal
              </p>
              <p
                className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[26px] leading-[1.5] left-[1050px] not-italic text-[#bddbc1] text-[17px] top-[343px] tracking-[0.34px] w-[209px]"
                data-node-id="1:355"
              >
                Points left to reach 80%
              </p>
              <p
                className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold h-[112px] leading-[1.5] left-[1050px] not-italic text-[#74ab7b] text-[75px] top-[242px] tracking-[1.5px] w-[245px]"
                data-node-id="1:356"
              >
                33 pts
              </p>
            </div>
          </div>
        </div>
        <div
          className="absolute bg-[#2b2b2b] border border-[#bddbc1] border-solid inset-[48.05%_4.58%_4.49%_12.78%] opacity-50 rounded-[20px]"
          data-node-id="1:357"
        />
        <div
          className="absolute inset-[57.52%_6.32%_5.18%_14.44%] overflow-clip"
          data-node-id="1:358"
          data-name="growth_pixel_chart_1141x382_v2 1"
        >
          <div
            className="absolute contents inset-[7.59%_9.38%_9.16%_5.26%]"
            data-node-id="1:359"
            data-name="blocks"
          >
            <div
              className="absolute inset-[7.59%_93.51%_9.16%_5.26%]"
              data-node-id="1:360"
              data-name="column-01"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn01} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_92.11%_9.16%_6.66%]"
              data-node-id="1:381"
              data-name="column-02"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn01} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_90.71%_9.16%_8.06%]"
              data-node-id="1:402"
              data-name="column-03"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn01} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_89.31%_9.16%_9.47%]"
              data-node-id="1:423"
              data-name="column-04"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn04} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_87.91%_9.16%_10.87%]"
              data-node-id="1:444"
              data-name="column-05"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn04} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_86.5%_9.16%_12.27%]"
              data-node-id="1:465"
              data-name="column-06"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn04} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_85.1%_9.16%_13.67%]"
              data-node-id="1:486"
              data-name="column-07"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn04} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_83.7%_9.16%_15.07%]"
              data-node-id="1:507"
              data-name="column-08"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn04} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_82.3%_9.16%_16.48%]"
              data-node-id="1:528"
              data-name="column-09"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn04} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_80.89%_9.16%_17.88%]"
              data-node-id="1:549"
              data-name="column-10"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn04} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_79.49%_9.16%_19.28%]"
              data-node-id="1:570"
              data-name="column-11"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn11} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_78.09%_9.16%_20.68%]"
              data-node-id="1:591"
              data-name="column-12"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn11} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_76.69%_9.16%_22.09%]"
              data-node-id="1:612"
              data-name="column-13"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn11} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_75.28%_9.16%_23.49%]"
              data-node-id="1:633"
              data-name="column-14"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn11} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_73.88%_9.16%_24.89%]"
              data-node-id="1:654"
              data-name="column-15"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn11} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_72.48%_9.16%_26.29%]"
              data-node-id="1:675"
              data-name="column-16"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn11} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_71.08%_9.16%_27.7%]"
              data-node-id="1:696"
              data-name="column-17"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn11} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_69.68%_9.16%_29.1%]"
              data-node-id="1:717"
              data-name="column-18"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn11} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_68.27%_9.16%_30.5%]"
              data-node-id="1:738"
              data-name="column-19"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn11} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_66.87%_9.16%_31.9%]"
              data-node-id="1:759"
              data-name="column-20"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn11} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_65.47%_9.16%_33.3%]"
              data-node-id="1:780"
              data-name="column-21"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_64.07%_9.16%_34.71%]"
              data-node-id="1:801"
              data-name="column-22"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_62.66%_9.16%_36.11%]"
              data-node-id="1:822"
              data-name="column-23"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_61.26%_9.16%_37.51%]"
              data-node-id="1:843"
              data-name="column-24"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_59.86%_9.16%_38.91%]"
              data-node-id="1:864"
              data-name="column-25"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_58.46%_9.16%_40.32%]"
              data-node-id="1:885"
              data-name="column-26"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_57.06%_9.16%_41.72%]"
              data-node-id="1:906"
              data-name="column-27"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_55.65%_9.16%_43.12%]"
              data-node-id="1:927"
              data-name="column-28"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_54.25%_9.16%_44.52%]"
              data-node-id="1:948"
              data-name="column-29"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_52.85%_9.16%_45.92%]"
              data-node-id="1:969"
              data-name="column-30"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_51.45%_9.16%_47.33%]"
              data-node-id="1:990"
              data-name="column-31"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_50.04%_9.16%_48.73%]"
              data-node-id="1:1011"
              data-name="column-32"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_48.64%_9.16%_50.13%]"
              data-node-id="1:1032"
              data-name="column-33"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_47.24%_9.16%_51.53%]"
              data-node-id="1:1053"
              data-name="column-34"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_45.84%_9.16%_52.94%]"
              data-node-id="1:1074"
              data-name="column-35"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_44.43%_9.16%_54.34%]"
              data-node-id="1:1095"
              data-name="column-36"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_43.03%_9.16%_55.74%]"
              data-node-id="1:1116"
              data-name="column-37"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_41.63%_9.16%_57.14%]"
              data-node-id="1:1137"
              data-name="column-38"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_40.23%_9.16%_58.55%]"
              data-node-id="1:1158"
              data-name="column-39"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_38.83%_9.16%_59.95%]"
              data-node-id="1:1179"
              data-name="column-40"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_37.42%_9.16%_61.35%]"
              data-node-id="1:1200"
              data-name="column-41"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn21} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_36.02%_9.16%_62.75%]"
              data-node-id="1:1221"
              data-name="column-42"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn42} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_34.62%_9.16%_64.15%]"
              data-node-id="1:1242"
              data-name="column-43"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn42} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_33.22%_9.16%_65.56%]"
              data-node-id="1:1263"
              data-name="column-44"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn42} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_31.81%_9.16%_66.96%]"
              data-node-id="1:1284"
              data-name="column-45"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn42} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_30.41%_9.16%_68.36%]"
              data-node-id="1:1305"
              data-name="column-46"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn46} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_29.01%_9.16%_69.76%]"
              data-node-id="1:1326"
              data-name="column-47"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn46} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_27.61%_9.16%_71.17%]"
              data-node-id="1:1347"
              data-name="column-48"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn46} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_26.21%_9.16%_72.57%]"
              data-node-id="1:1368"
              data-name="column-49"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn46} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_24.8%_9.16%_73.97%]"
              data-node-id="1:1389"
              data-name="column-50"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn46} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_23.4%_9.16%_75.37%]"
              data-node-id="1:1410"
              data-name="column-51"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn46} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_22%_9.16%_76.77%]"
              data-node-id="1:1431"
              data-name="column-52"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn46} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_20.6%_9.16%_78.18%]"
              data-node-id="1:1452"
              data-name="column-53"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn42} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_19.19%_9.16%_79.58%]"
              data-node-id="1:1473"
              data-name="column-54"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn42} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_17.79%_9.16%_80.98%]"
              data-node-id="1:1494"
              data-name="column-55"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn42} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_16.39%_9.16%_82.38%]"
              data-node-id="1:1515"
              data-name="column-56"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn42} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_14.99%_9.16%_83.79%]"
              data-node-id="1:1536"
              data-name="column-57"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn42} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_13.58%_9.16%_85.19%]"
              data-node-id="1:1557"
              data-name="column-58"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn42} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_12.18%_9.16%_86.59%]"
              data-node-id="1:1578"
              data-name="column-59"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn59} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_10.78%_9.16%_87.99%]"
              data-node-id="1:1599"
              data-name="column-60"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn59} />
              </div>
            </div>
            <div
              className="absolute inset-[7.59%_9.38%_9.16%_89.4%]"
              data-node-id="1:1620"
              data-name="column-61"
            >
              <div className="absolute inset-[0_-5.36%]">
                <img alt="" className="block max-w-none size-full" src={imgColumn59} />
              </div>
            </div>
          </div>
          <div
            className="[word-break:break-word] absolute contents font-['Inter:Regular'] font-normal inset-[4.45%_95.79%_6.81%_0.61%] leading-[normal] not-italic text-[#a3b2a8] text-[16px] text-right whitespace-nowrap"
            data-node-id="1:1641"
            data-name="y-axis-labels"
          >
            <p className="absolute inset-[88.22%_95.79%_6.81%_2.19%]" data-node-id="1:1642">
              0%
            </p>
            <p className="absolute inset-[67.28%_95.79%_27.75%_1.31%]" data-node-id="1:1643">
              25%
            </p>
            <p className="absolute inset-[46.34%_95.79%_48.69%_1.31%]" data-node-id="1:1644">
              50%
            </p>
            <p className="absolute inset-[25.39%_95.79%_69.63%_1.4%]" data-node-id="1:1645">
              75%
            </p>
            <p className="absolute inset-[4.45%_95.79%_90.58%_0.61%]" data-node-id="1:1646">
              100%
            </p>
          </div>
          <div
            className="[word-break:break-word] absolute contents inset-[93.72%_9.38%_1.31%_5.26%] leading-[normal] not-italic text-[16px] whitespace-nowrap"
            data-node-id="1:1647"
            data-name="week-labels"
          >
            <p
              className="absolute font-['Inter:Regular'] font-normal inset-[93.72%_91.06%_1.31%_5.26%] text-[#a3b2a8]"
              data-node-id="1:1648"
            >
              Oct 5
            </p>
            <p
              className="absolute font-['Inter:Regular'] font-normal inset-[93.72%_75.15%_1.31%_20.55%] text-[#a3b2a8] text-center"
              data-node-id="1:1649"
            >
              Oct 12
            </p>
            <p
              className="absolute font-['Inter:Regular'] font-normal inset-[93.72%_58.33%_1.31%_37.38%] text-[#a3b2a8] text-center"
              data-node-id="1:1650"
            >
              Oct 19
            </p>
            <p
              className="absolute font-['Inter:Regular'] font-normal inset-[93.72%_41.37%_1.31%_54.08%] text-[#a3b2a8] text-center"
              data-node-id="1:1651"
            >
              Oct 26
            </p>
            <p
              className="absolute font-['Inter:Regular'] font-normal inset-[93.72%_24.85%_1.31%_71.21%] text-[#a3b2a8] text-center"
              data-node-id="1:1652"
            >
              Nov 2
            </p>
            <p
              className="absolute font-['Inter:Bold'] font-bold inset-[93.72%_9.38%_1.31%_86.68%] text-[#eaf3ec] text-right"
              data-node-id="1:1653"
            >
              Nov 9
            </p>
          </div>
          <div
            className="absolute contents inset-[32.46%_7.1%_48.69%_87.12%]"
            data-node-id="1:1654"
            data-name="goblin"
          >
            <div
              className="absolute inset-[40.31%_10.78%_58.12%_88.69%]"
              data-node-id="1:1655"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[40.31%_10.25%_58.12%_89.22%]"
              data-node-id="1:1656"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[40.31%_9.73%_58.12%_89.75%]"
              data-node-id="1:1657"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[40.31%_9.2%_58.12%_90.27%]"
              data-node-id="1:1658"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[40.31%_8.68%_58.12%_90.8%]"
              data-node-id="1:1659"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[41.88%_11.31%_56.54%_88.17%]"
              data-node-id="1:1660"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[41.88%_10.78%_56.54%_88.69%]"
              data-node-id="1:1661"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[41.88%_10.25%_56.54%_89.22%]"
              data-node-id="1:1662"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[41.88%_9.73%_56.54%_89.75%]"
              data-node-id="1:1663"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[41.88%_9.2%_56.54%_90.27%]"
              data-node-id="1:1664"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[41.88%_8.68%_56.54%_90.8%]"
              data-node-id="1:1665"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[41.88%_8.15%_56.54%_91.32%]"
              data-node-id="1:1666"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[43.46%_12.36%_54.97%_87.12%]"
              data-node-id="1:1667"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[43.46%_11.83%_54.97%_87.64%]"
              data-node-id="1:1668"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[43.46%_11.31%_54.97%_88.17%]"
              data-node-id="1:1669"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[43.46%_10.78%_54.97%_88.69%]"
              data-node-id="1:1670"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[43.46%_10.25%_54.97%_89.22%]"
              data-node-id="1:1671"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[43.46%_9.73%_54.97%_89.75%]"
              data-node-id="1:1672"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[43.46%_9.2%_54.97%_90.27%]"
              data-node-id="1:1673"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[43.46%_8.68%_54.97%_90.8%]"
              data-node-id="1:1674"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[43.46%_8.15%_54.97%_91.32%]"
              data-node-id="1:1675"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[43.46%_7.62%_54.97%_91.85%]"
              data-node-id="1:1676"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[43.46%_7.1%_54.97%_92.38%]"
              data-node-id="1:1677"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[45.03%_12.36%_53.4%_87.12%]"
              data-node-id="1:1678"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[45.03%_11.83%_53.4%_87.64%]"
              data-node-id="1:1679"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[45.03%_11.31%_53.4%_88.17%]"
              data-node-id="1:1680"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[45.03%_10.78%_53.4%_88.69%]"
              data-node-id="1:1681"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector8}
              />
            </div>
            <div
              className="absolute inset-[45.03%_10.25%_53.4%_89.22%]"
              data-node-id="1:1682"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[45.03%_9.73%_53.4%_89.75%]"
              data-node-id="1:1683"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[45.03%_9.2%_53.4%_90.27%]"
              data-node-id="1:1684"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[45.03%_8.68%_53.4%_90.8%]"
              data-node-id="1:1685"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector8}
              />
            </div>
            <div
              className="absolute inset-[45.03%_8.15%_53.4%_91.32%]"
              data-node-id="1:1686"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[45.03%_7.62%_53.4%_91.85%]"
              data-node-id="1:1687"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[45.03%_7.1%_53.4%_92.38%]"
              data-node-id="1:1688"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[46.6%_11.83%_51.83%_87.64%]"
              data-node-id="1:1689"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[46.6%_11.31%_51.83%_88.17%]"
              data-node-id="1:1690"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[46.6%_10.78%_51.83%_88.69%]"
              data-node-id="1:1691"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[46.6%_10.25%_51.83%_89.22%]"
              data-node-id="1:1692"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[46.6%_9.73%_51.83%_89.75%]"
              data-node-id="1:1693"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[46.6%_9.2%_51.83%_90.27%]"
              data-node-id="1:1694"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[46.6%_8.68%_51.83%_90.8%]"
              data-node-id="1:1695"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[46.6%_8.15%_51.83%_91.32%]"
              data-node-id="1:1696"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[46.6%_7.62%_51.83%_91.85%]"
              data-node-id="1:1697"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[48.17%_11.31%_50.26%_88.17%]"
              data-node-id="1:1698"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[48.17%_10.78%_50.26%_88.69%]"
              data-node-id="1:1699"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[48.17%_10.25%_50.26%_89.22%]"
              data-node-id="1:1700"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[48.17%_9.73%_50.26%_89.75%]"
              data-node-id="1:1701"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[48.17%_9.2%_50.26%_90.27%]"
              data-node-id="1:1702"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[48.17%_8.68%_50.26%_90.8%]"
              data-node-id="1:1703"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[48.17%_8.15%_50.26%_91.32%]"
              data-node-id="1:1704"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[49.74%_10.78%_48.69%_88.69%]"
              data-node-id="1:1705"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[49.74%_10.25%_48.69%_89.22%]"
              data-node-id="1:1706"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[49.74%_9.73%_48.69%_89.75%]"
              data-node-id="1:1707"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[49.74%_9.2%_48.69%_90.27%]"
              data-node-id="1:1708"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <div
              className="absolute inset-[49.74%_8.68%_48.69%_90.8%]"
              data-node-id="1:1709"
              data-name="Vector"
            >
              <img
                alt=""
                className="absolute block inset-0 max-w-none size-full"
                src={imgVector7}
              />
            </div>
            <p
              className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold inset-[32.46%_8.11%_61.26%_88.12%] leading-[normal] not-italic text-[#f2f8f3] text-[20px] text-center whitespace-nowrap"
              data-node-id="1:1710"
            >
              47%
            </p>
          </div>
          <p
            className="[word-break:break-word] absolute font-['Inter:Bold'] font-bold inset-[23.3%_1.75%_71.73%_91.67%] leading-[normal] not-italic text-[#bddbc1] text-[16px] whitespace-nowrap"
            data-node-id="1:1711"
          >
            Goal 80%
          </p>
        </div>
        <div
          className="[word-break:break-word] absolute font-['Inter:Semi_Bold'] font-semibold inset-[43.07%_65.69%_54.1%_12.78%] leading-[0] not-italic text-[#bddbc1] text-[20px] tracking-[0.4px]"
          data-node-id="1:1712"
        >
          <p className="leading-[1.5] mb-0">Comprehension score by week</p>
          <p className="leading-[1.5]">​</p>
        </div>
        <p
          className="[word-break:break-word] absolute font-['Inter:Semi_Bold'] font-semibold inset-[50.29%_64.1%_42.48%_14.44%] leading-[0] not-italic text-[#bddbc1] text-[0px] tracking-[0.4px]"
          data-node-id="1:1713"
        >
          <span className="font-['Inter:Bold'] font-bold leading-[1.5] text-[50px]">47%</span>
          <span className="leading-[1.5] text-[20px]">{` `}</span>
          <span className="leading-[1.5] text-[17px]">Down 7 from last week</span>
        </p>
        <User className="absolute flex h-[50px] items-center justify-center left-[1128px] top-[55px] w-[246px]" />
        <div className="absolute contents left-[662px] top-[550px]" data-node-id="1:1715">
          <p
            className="[word-break:break-word] absolute font-['Inter:Semi_Bold'] font-semibold inset-[53.81%_6.32%_44.24%_83.47%] leading-[1.5] not-italic text-[#bddbc1] text-[17px] tracking-[0.34px]"
            data-node-id="1:1716"
          >
            80% weekly goal
          </p>
          <p
            className="[word-break:break-word] absolute font-['Inter:Semi_Bold'] font-semibold inset-[53.71%_21.18%_44.34%_67.15%] leading-[1.5] not-italic text-[#bddbc1] text-[17px] tracking-[0.34px]"
            data-node-id="1:1717"
          >
            This week progress
          </p>
          <p
            className="[word-break:break-word] absolute font-['Inter:Semi_Bold'] font-semibold inset-[53.71%_37.5%_44.34%_48.19%] leading-[1.5] not-italic text-[#74ab7b] text-[17px] tracking-[0.34px]"
            data-node-id="1:1718"
          >
            Previous week progress
          </p>
          <div
            className="absolute bg-[#171614] border-2 border-[#bddbc1] border-dashed left-[1170px] rounded-[5px] size-[18px] top-[553px]"
            data-node-id="1:1719"
          />
          <div
            className="absolute bg-[#bddbc1] left-[935px] rounded-[5px] size-[18px] top-[552px]"
            data-node-id="1:1720"
          />
          <div
            className="absolute bg-[#74ab7b] left-[662px] rounded-[5px] size-[18px] top-[552px]"
            data-node-id="1:1721"
          />
        </div>
      </div>
    </div>
  );
}
