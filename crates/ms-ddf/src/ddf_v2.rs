use easy_xml_derive::XmlDeserialize;

use crate::msft;

#[derive(XmlDeserialize, Debug)]
#[easy_xml(root)]
pub struct MgmtTree {
    #[easy_xml(rename = "VerDTD")]
    pub ver_dtd: String,
    #[easy_xml(rename = "Node")]
    pub nodes: Vec<Node>,
}

#[derive(XmlDeserialize, Debug)]
pub struct Node {
    #[easy_xml(rename = "NodeName")]
    pub node_name: String,
    #[easy_xml(rename = "Path")]
    pub path: Option<String>,
    #[easy_xml(rename = "Node")]
    pub children: Vec<Node>,
    #[easy_xml(rename = "DFProperties")]
    pub properties: DFProperties,
}

#[derive(XmlDeserialize, Debug)]
pub struct DFProperties {
    #[easy_xml(rename = "AccessType")]
    pub access_type: AccessType,
    #[easy_xml(rename = "DefaultValue")]
    pub default_value: Option<String>,
    #[easy_xml(rename = "Description")]
    pub description: Option<String>,
    #[easy_xml(rename = "DFFormat")]
    pub df_format: DFFormat,
    #[easy_xml(rename = "Occurrence")]
    pub occurrence: Option<Occurrence>,
    #[easy_xml(rename = "Scope")]
    pub scope: Option<Scope>,
    #[easy_xml(rename = "DFTitle")]
    pub df_title: Option<String>,
    #[easy_xml(rename = "DFType")]
    pub df_type: String,
    #[easy_xml(rename = "CaseSense")]
    pub case_sense: Option<String>,
    #[easy_xml(rename = "AllowedValues")]
    pub allowed_values: Option<msft::AllowedValues>,
}

#[derive(XmlDeserialize, Debug)]
pub struct AccessType {
    #[easy_xml(rename = "Add")]
    pub add: Option<Element>,
    #[easy_xml(rename = "Copy")]
    pub copy: Option<Element>,
    #[easy_xml(rename = "Delete")]
    pub delete: Option<Element>,
    #[easy_xml(rename = "Exec")]
    pub exec: Option<Element>,
    #[easy_xml(rename = "Get")]
    pub get: Option<Element>,
    #[easy_xml(rename = "Replace")]
    pub replace: Option<Element>,
}

impl AccessType {
    pub fn len(&self) -> u8 {
        let mut count = 0;
        if self.add.is_some() {
            count += 1;
        }
        if self.copy.is_some() {
            count += 1;
        }
        if self.delete.is_some() {
            count += 1;
        }
        if self.exec.is_some() {
            count += 1;
        }
        if self.get.is_some() {
            count += 1;
        }
        if self.replace.is_some() {
            count += 1;
        }
        count
    }
}

#[derive(XmlDeserialize, Debug)]
pub struct DFFormat {
    #[easy_xml(rename = "b64|bin|bool|chr|int|node|null|xml|date|time|float")]
    variant: DFFormatVariant,
}

impl std::ops::Deref for DFFormat {
    type Target = DFFormatVariant;

    fn deref(&self) -> &Self::Target {
        &self.variant
    }
}

#[derive(XmlDeserialize, Debug)]
pub enum DFFormatVariant {
    #[easy_xml(rename = "b64")]
    Base64,
    #[easy_xml(rename = "bin")]
    Bin,
    #[easy_xml(rename = "bool")]
    Bool,
    #[easy_xml(rename = "chr")]
    String,
    #[easy_xml(rename = "int")]
    Int,
    #[easy_xml(rename = "node")]
    Node,
    #[easy_xml(rename = "null")]
    Null,
    #[easy_xml(rename = "xml")]
    Xml,
    #[easy_xml(rename = "date")]
    Date,
    #[easy_xml(rename = "time")]
    Time,
    #[easy_xml(rename = "float")]
    Float,
}

impl ToString for DFFormatVariant {
    fn to_string(&self) -> String {
        match self {
            DFFormatVariant::Base64 => "b64".to_string(),
            DFFormatVariant::Bin => "bin".to_string(),
            DFFormatVariant::Bool => "bool".to_string(),
            DFFormatVariant::String => "chr".to_string(),
            DFFormatVariant::Int => "int".to_string(),
            DFFormatVariant::Node => "node".to_string(),
            DFFormatVariant::Null => "null".to_string(),
            DFFormatVariant::Xml => "xml".to_string(),
            DFFormatVariant::Date => "date".to_string(),
            DFFormatVariant::Time => "time".to_string(),
            DFFormatVariant::Float => "float".to_string(),
        }
    }
}

#[derive(XmlDeserialize, Debug)]
pub struct Occurrence {
    #[easy_xml(rename = "One|ZeroOrOne|ZeroOrMore|OneOrMore|ZeroOrN|OneOrN")]
    variant: OccurrenceVariant,
}

impl std::ops::Deref for Occurrence {
    type Target = OccurrenceVariant;

    fn deref(&self) -> &Self::Target {
        &self.variant
    }
}

#[derive(XmlDeserialize, Debug)]
pub enum OccurrenceVariant {
    One,
    ZeroOrOne,
    ZeroOrMore,
    OneOrMore,
    ZeroOrN(#[easy_xml(text)] i32),
    OneOrN(#[easy_xml(text)] i32),
}

#[derive(XmlDeserialize, Debug)]
pub struct Scope {
    #[easy_xml(rename = "Permanent|Dynamic")]
    variant: ScopeVariant,
}

impl std::ops::Deref for Scope {
    type Target = ScopeVariant;

    fn deref(&self) -> &Self::Target {
        &self.variant
    }
}

#[derive(XmlDeserialize, Debug)]
pub enum ScopeVariant {
    Permanent,
    Dynamic,
}

#[derive(XmlDeserialize, Debug)]
pub struct Element;

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn parse_test() {
        let doc = easy_xml::de::from_str::<MgmtTree>(Education_AreaDDF).unwrap();
        dbg!(doc);
    }

    const Education_AreaDDF: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE MgmtTree PUBLIC " -//OMA//DTD-DM-DDF 1.2//EN"
  "http://www.openmobilealliance.org/tech/DTD/DM_DDF-V1_2.dtd"
  [<?oma-dm-ddf-ver supported-versions="1.2"?>]>
<MgmtTree xmlns:MSFT="http://schemas.microsoft.com/MobileDevice/DM">
  <VerDTD>1.2</VerDTD>
  <Node>
    <NodeName>Education</NodeName>
    <Path>./User/Vendor/MSFT/Policy/Config</Path>
    <DFProperties>
      <AccessType>
        <Get />
      </AccessType>
      <DFFormat>
        <node />
      </DFFormat>
      <Occurrence>
        <One />
      </Occurrence>
      <Scope>
        <Permanent />
      </Scope>
      <DFType>
        <MIME>com.microsoft/11/MDM/Policy</MIME>
      </DFType>
    </DFProperties>
    <Node>
      <NodeName>AllowGraphingCalculator</NodeName>
      <DFProperties>
        <AccessType>
          <Add />
          <Delete />
          <Get />
          <Replace />
        </AccessType>
        <Description>This policy setting allows you to control whether graphing functionality is available in the Windows Calculator app. If you disable this policy setting, graphing functionality will not be accessible in the Windows Calculator app. If you enable or don't configure this policy setting, users will be able to access graphing functionality.</Description>
        <DFFormat>
          <int />
        </DFFormat>
        <Occurrence>
          <ZeroOrOne />
        </Occurrence>
        <Scope>
          <Dynamic />
        </Scope>
        <DFType>
          <MIME>text/plain</MIME>
        </DFType>
        <DefaultValue>1</DefaultValue>
        <MSFT:Applicability>
          <MSFT:OsBuildVersion>10.0.19041</MSFT:OsBuildVersion>
          <MSFT:CspVersion>10.0</MSFT:CspVersion>
          <MSFT:EditionAllowList>0x4;0x1B;0x30;0x31;0x48;0x54;0x62;0x63;0x64;0x65;0x79;0x7A;0x7D;0x7E;0x81;0x82;0x8A;0x8B;0xA1;0xA2;0xA4;0xA5;0xAB;0xAC;0xBC;0xBF;0xCA;0xCB;0xCD;</MSFT:EditionAllowList>
        </MSFT:Applicability>
        <MSFT:AllowedValues ValueType="ENUM">
          <MSFT:Enum>
            <MSFT:Value>0</MSFT:Value>
            <MSFT:ValueDescription>Disabled.</MSFT:ValueDescription>
          </MSFT:Enum>
          <MSFT:Enum>
            <MSFT:Value>1</MSFT:Value>
            <MSFT:ValueDescription>Enabled.</MSFT:ValueDescription>
          </MSFT:Enum>
        </MSFT:AllowedValues>
        <MSFT:GpMapping GpEnglishName="AllowGraphingCalculator" GpAreaPath="Programs~AT~WindowsComponents~Calculator" />
        <MSFT:ConflictResolution>LowestValueMostSecure</MSFT:ConflictResolution>
      </DFProperties>
    </Node>
    <Node>
      <NodeName>DefaultPrinterName</NodeName>
      <DFProperties>
        <AccessType>
          <Add />
          <Delete />
          <Get />
          <Replace />
        </AccessType>
        <Description>This policy sets user's default printer</Description>
        <DFFormat>
          <chr />
        </DFFormat>
        <Occurrence>
          <ZeroOrOne />
        </Occurrence>
        <Scope>
          <Dynamic />
        </Scope>
        <DFType>
          <MIME>text/plain</MIME>
        </DFType>
        <MSFT:Applicability>
          <MSFT:OsBuildVersion>10.0.16299</MSFT:OsBuildVersion>
          <MSFT:CspVersion>6.0</MSFT:CspVersion>
          <MSFT:EditionAllowList>0x4;0x1B;0x30;0x31;0x48;0x54;0x79;0x7A;0x7D;0x7E;0x81;0x82;0x8A;0x8B;0xA1;0xA2;0xA4;0xA5;0xAB;0xAC;0xBC;0xBF;0xCA;0xCB;0xCD;</MSFT:EditionAllowList>
        </MSFT:Applicability>
        <MSFT:ConflictResolution>LastWrite</MSFT:ConflictResolution>
      </DFProperties>
    </Node>
    <Node>
      <NodeName>PreventAddingNewPrinters</NodeName>
      <DFProperties>
        <AccessType>
          <Add />
          <Delete />
          <Get />
          <Replace />
        </AccessType>
        <Description>Boolean that specifies whether or not to prevent user to install new printers</Description>
        <DFFormat>
          <int />
        </DFFormat>
        <Occurrence>
          <ZeroOrOne />
        </Occurrence>
        <Scope>
          <Dynamic />
        </Scope>
        <DFType>
          <MIME>text/plain</MIME>
        </DFType>
        <DefaultValue>0</DefaultValue>
        <MSFT:Applicability>
          <MSFT:OsBuildVersion>10.0.16299</MSFT:OsBuildVersion>
          <MSFT:CspVersion>6.0</MSFT:CspVersion>
          <MSFT:EditionAllowList>0x4;0x1B;0x30;0x31;0x48;0x54;0x79;0x7A;0x7D;0x7E;0x81;0x82;0x8A;0x8B;0xA1;0xA2;0xA4;0xA5;0xAB;0xAC;0xBC;0xBF;0xCA;0xCB;0xCD;</MSFT:EditionAllowList>
        </MSFT:Applicability>
        <MSFT:AllowedValues ValueType="ENUM">
          <MSFT:Enum>
            <MSFT:Value>0</MSFT:Value>
            <MSFT:ValueDescription>Allow user installation.</MSFT:ValueDescription>
          </MSFT:Enum>
          <MSFT:Enum>
            <MSFT:Value>1</MSFT:Value>
            <MSFT:ValueDescription>Prevent user installation.</MSFT:ValueDescription>
          </MSFT:Enum>
        </MSFT:AllowedValues>
        <MSFT:GpMapping GpEnglishName="NoAddPrinter" GpAreaPath="Printing~AT~ControlPanel~CplPrinters" />
        <MSFT:ConflictResolution>HighestValueMostSecure</MSFT:ConflictResolution>
      </DFProperties>
    </Node>
    <Node>
      <NodeName>PrinterNames</NodeName>
      <DFProperties>
        <AccessType>
          <Add />
          <Delete />
          <Get />
          <Replace />
        </AccessType>
        <Description>This policy provisions per-user network printers</Description>
        <DFFormat>
          <chr />
        </DFFormat>
        <Occurrence>
          <ZeroOrOne />
        </Occurrence>
        <Scope>
          <Dynamic />
        </Scope>
        <DFType>
          <MIME>text/plain</MIME>
        </DFType>
        <MSFT:Applicability>
          <MSFT:OsBuildVersion>10.0.16299</MSFT:OsBuildVersion>
          <MSFT:CspVersion>6.0</MSFT:CspVersion>
          <MSFT:EditionAllowList>0x4;0x1B;0x30;0x31;0x48;0x54;0x79;0x7A;0x7D;0x7E;0x81;0x82;0x8A;0x8B;0xA1;0xA2;0xA4;0xA5;0xAB;0xAC;0xBC;0xBF;0xCA;0xCB;0xCD;</MSFT:EditionAllowList>
        </MSFT:Applicability>
        <MSFT:AllowedValues ValueType="None">
          <MSFT:List Delimiter="0xF000" />
        </MSFT:AllowedValues>
        <MSFT:ConflictResolution>LastWrite</MSFT:ConflictResolution>
      </DFProperties>
    </Node>
  </Node>
  <Node>
    <NodeName>Education</NodeName>
    <Path>./Device/Vendor/MSFT/Policy/Config</Path>
    <DFProperties>
      <AccessType>
        <Get />
      </AccessType>
      <DFFormat>
        <node />
      </DFFormat>
      <Occurrence>
        <One />
      </Occurrence>
      <Scope>
        <Permanent />
      </Scope>
      <DFType>
        <MIME>com.microsoft/11/MDM/Policy</MIME>
      </DFType>
    </DFProperties>
    <Node>
      <NodeName>EnableEduThemes</NodeName>
      <DFProperties>
        <AccessType>
          <Add />
          <Delete />
          <Get />
          <Replace />
        </AccessType>
        <Description>This policy setting allows you to control whether EDU-specific theme packs are available in Settings &gt; Personalization. If you disable or don't configure this policy setting, EDU-specific theme packs will not be included. If you enable this policy setting, users will be able to personalize their devices with EDU-specific themes.</Description>
        <DFFormat>
          <int />
        </DFFormat>
        <Occurrence>
          <ZeroOrOne />
        </Occurrence>
        <Scope>
          <Dynamic />
        </Scope>
        <DFType>
          <MIME>text/plain</MIME>
        </DFType>
        <DefaultValue>0</DefaultValue>
        <MSFT:Applicability>
          <MSFT:OsBuildVersion>10.0.22621</MSFT:OsBuildVersion>
          <MSFT:CspVersion>11.0</MSFT:CspVersion>
          <MSFT:EditionAllowList>0x4;0x1B;0x30;0x31;0x48;0x54;0x79;0x7A;0x7D;0x7E;0x81;0x82;0x8A;0x8B;0xA1;0xA2;0xA4;0xA5;0xAB;0xAC;0xBC;0xBF;0xCA;0xCB;0xCD;</MSFT:EditionAllowList>
        </MSFT:Applicability>
        <MSFT:AllowedValues ValueType="ENUM">
          <MSFT:Enum>
            <MSFT:Value>0</MSFT:Value>
            <MSFT:ValueDescription>Disabled.</MSFT:ValueDescription>
          </MSFT:Enum>
          <MSFT:Enum>
            <MSFT:Value>1</MSFT:Value>
            <MSFT:ValueDescription>Enabled.</MSFT:ValueDescription>
          </MSFT:Enum>
        </MSFT:AllowedValues>
        <MSFT:ConflictResolution>LowestValueMostSecure</MSFT:ConflictResolution>
      </DFProperties>
    </Node>
    <Node>
      <NodeName>IsEducationEnvironment</NodeName>
      <DFProperties>
        <AccessType>
          <Add />
          <Delete />
          <Get />
          <Replace />
        </AccessType>
        <Description>This policy setting allows tenant to control whether to declare this OS as an education environment</Description>
        <DFFormat>
          <int />
        </DFFormat>
        <Occurrence>
          <ZeroOrOne />
        </Occurrence>
        <Scope>
          <Dynamic />
        </Scope>
        <DFType>
          <MIME>text/plain</MIME>
        </DFType>
        <DefaultValue>0</DefaultValue>
        <MSFT:Applicability>
          <MSFT:OsBuildVersion>10.0.22621</MSFT:OsBuildVersion>
          <MSFT:CspVersion>11.0</MSFT:CspVersion>
          <MSFT:EditionAllowList>0x4;0x1B;0x30;0x31;0x48;0x54;0x79;0x7A;0x7D;0x7E;0x81;0x82;0x8A;0x8B;0xA1;0xA2;0xA4;0xA5;0xAB;0xAC;0xBC;0xBF;0xCA;0xCB;0xCD;</MSFT:EditionAllowList>
        </MSFT:Applicability>
        <MSFT:AllowedValues ValueType="ENUM">
          <MSFT:Enum>
            <MSFT:Value>0</MSFT:Value>
            <MSFT:ValueDescription>Disabled.</MSFT:ValueDescription>
          </MSFT:Enum>
          <MSFT:Enum>
            <MSFT:Value>1</MSFT:Value>
            <MSFT:ValueDescription>Enabled.</MSFT:ValueDescription>
          </MSFT:Enum>
        </MSFT:AllowedValues>
        <MSFT:ConflictResolution>LowestValueMostSecure</MSFT:ConflictResolution>
      </DFProperties>
    </Node>
  </Node>
</MgmtTree>"#;
}
