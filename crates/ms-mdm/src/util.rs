use xml::{EmitterConfig, ParserConfig};

// TODO: Remove the need for this. It's to workaround a bug in `easy-xml`.
pub fn strip_whitespace_from_xml(xml: &str) -> Result<String, Box<dyn std::error::Error>> {
    let mut xml = xml.as_bytes();
    let mut reader = ParserConfig::default().create_reader(&mut xml);

    let mut out = Vec::new();
    let mut writer = EmitterConfig::default().create_writer(&mut out);

    loop {
        match reader.next()? {
            xml::reader::XmlEvent::EndDocument => break,
            xml::reader::XmlEvent::Whitespace(_) => {}
            other => {
                if let Some(writer_event) = other.as_writer_event() {
                    writer.write(writer_event)?;
                }
            }
        }
    }

    Ok(String::from_utf8(out)?)
}
