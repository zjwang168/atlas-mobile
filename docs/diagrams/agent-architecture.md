flowchart TD
  %% ===== NATURAL / HAND-PICKED COLOR PALETTE (Academic, low-saturation, warm) =====
  classDef boundary fill:#f7f7f7,stroke:#aaaaaa,stroke-width:1px,color:#333333;
  classDef yellow fill:#fcf6e8,stroke:#c4a87a,stroke-width:3px,color:#333333;
  classDef blue fill:#e4edf5,stroke:#7a9bb5,stroke-width:2px,color:#333333;
  classDef green fill:#e4efe4,stroke:#7a9b7a,stroke-width:2px,color:#333333;
  classDef red fill:#f5e8e8,stroke:#b57a7a,stroke-width:2px,stroke-dasharray:6 4,color:#333333;
  classDef external fill:#ede7f5,stroke:#9b8bb5,stroke-width:2px,color:#333333;
  classDef white fill:#ffffff,stroke:#ffffff,stroke-width:0px;
  classDef title fill:#fcf6e8,stroke:#c4a87a,stroke-width:0px,font-size:16px,font-weight:bold,color:#333333;

  %% ===== COLUMN 1 =====
  subgraph Col1[" "]
     direction TB
     C[Mobile Client<br/>Expo / React Native]:::boundary
  end

  %% ===== COLUMN 2 =====
  subgraph Col2[" "]
     direction TB

     subgraph AgentLoop[" "]
        direction TB
        ATitle["<b><big>Agent Loop - Fenced Brain</big></b>"]:::title
        subgraph AgentContent[" "]
           direction LR
           S["<b>Session State</b><br/>20 msg context"]:::blue
           M["<b>Model Invoker</b><br/>GPT-5.6 Luna"]:::blue
           R{"<b>Router</b><br/>Whitelist + Errors"}:::blue
           S --> M --> R
           R -->|Result| M
        end
     end

     subgraph ToolLayer[" "]
        direction TB
        TTitle["<b><big>Tool Layer - Read Only (10+ Tools)</big></b>"]:::title
        subgraph ToolContent[" "]
           direction LR
           T1["<b>Place Resolvers</b><br/>resolve_special, find_nearby, find_between, present"]:::green
           T2["<b>Live Research</b><br/>find_verified, web_search, extract_pasted, screen_locations"]:::green
           T3["<b>Proposal Generators</b><br/>propose_add_places, propose_create_atlas, propose_special"]:::red
           T1 --- T2 --- T3
        end
     end
  end

  %% ===== COLUMN 3 =====
  subgraph Col3[" "]
     direction TB

     subgraph Ingestion[" "]
        direction TB
        ITitle["<b><big>Ingestion Pipeline - Deterministic DAG</big></b>"]:::title
        subgraph IngestionContent[" "]
           direction LR
           I1[Fetch / Scrape]:::green
           I2{Classify<br/>Address vs POI}:::blue
           I3[Extract / Entity Link]:::green
           I4[Geocode / Region Filter]:::green
           I5[Route Planning]:::green
           I1 --> I2
           I2 -->|Address| I4
           I2 -->|Named POI| I3 --> I4
           I4 --> I5
        end
     end

     subgraph OutputGate[" "]
        direction TB
        OTitle["<b><big>Output & Confirmation Gate</big></b>"]:::title
        subgraph OutputContent[" "]
           direction LR
           O1["<b>Generate Presentation</b><br/>& Pending Action"]:::blue
           O2["<b>POST /confirm</b><br/>Audit Log"]:::red
           O1 --- O2
        end
     end
  end

  %% ===== COLUMN 4 =====
  subgraph Col4[" "]
     direction TB
     subgraph External[" "]
        direction TB
        ETitle["<b><big>External Dependencies</big></b>"]:::title
        subgraph ExternalContent[" "]
           direction LR
           E1[Mapbox<br/>Search / Route]:::external
           E2[OpenAI API<br/>+ Web Search]:::external
           E3[Web / Social / OCR<br/>Gemini / GLM]:::external
           E4[(Supabase<br/>RLS / Audit)]:::boundary
           E1 --- E2 --- E3 --- E4
        end
     end
  end

  %% ===== CONNECTIONS (unchanged) =====
  C -->|"1. Chat / Parse"| AgentLoop
  C -->|"2. Parse Request"| Ingestion

  AgentLoop -->|"3. Tool Call"| ToolLayer
  ToolLayer -->|"4. Research / Geocode"| External
  Ingestion -->|"5. Geocode / Scrape"| External

  AgentLoop -->|"6. Proposal"| OutputGate
  Ingestion -->|"7. Candidates"| OutputGate

  OutputGate -->|"8. Pending Action"| C

  C -->|"9. User Confirms (Write)"| External
  C -->|"10. Audit Event"| OutputGate

  OutputGate -->|"11. Clear Pending Action"| AgentLoop
  OutputGate -->|"12. Persist Log"| External

  Ingestion -->|"13. Async History"| External

  %% ===== CONSTRAINT =====
  Constraint[/Hard Boundaries:<br/>Max 6 steps / 90s timeout<br/>All tools read-only / Write requires user confirm/]:::red
  Constraint -.-> AgentLoop

  %% ===== YELLOW BOX STYLES (natural) =====
  style AgentLoop fill:#fcf6e8,stroke:#c4a87a,stroke-width:3px
  style ToolLayer fill:#fcf6e8,stroke:#c4a87a,stroke-width:3px
  style Ingestion fill:#fcf6e8,stroke:#c4a87a,stroke-width:3px
  style OutputGate fill:#fcf6e8,stroke:#c4a87a,stroke-width:3px
  style External fill:#ede7f5,stroke:#9b8bb5,stroke-width:2px

  %% ===== HIDE COLUMN CONTAINERS =====
  style Col1 fill:#ffffff,stroke:#ffffff,stroke-width:0px
  style Col2 fill:#ffffff,stroke:#ffffff,stroke-width:0px
  style Col3 fill:#ffffff,stroke:#ffffff,stroke-width:0px
  style Col4 fill:#ffffff,stroke:#ffffff,stroke-width:0px

  %% ===== HIDE INNER SUBGRAPH BORDERS =====
  style AgentContent fill:#ffffff,stroke:#ffffff,stroke-width:0px
  style ToolContent fill:#ffffff,stroke:#ffffff,stroke-width:0px
  style IngestionContent fill:#ffffff,stroke:#ffffff,stroke-width:0px
  style OutputContent fill:#ffffff,stroke:#ffffff,stroke-width:0px
  style ExternalContent fill:#ffffff,stroke:#ffffff,stroke-width:0px

这个你能给我看看mermaid图吗